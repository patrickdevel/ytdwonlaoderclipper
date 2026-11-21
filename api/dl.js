// /api/dl?action=info&url=…        → Metadaten + Formate
// /api/dl?url=…&itag=…             → Stream (mit Content-Disposition)
const ytdl = require('@distube/ytdl-core');

module.exports = async function handler(req, res) {
  const url = String((req.query && req.query.url) || '').trim();
  if (!url) return res.status(400).json({ error: 'URL fehlt (?url=https://youtu.be/…)' });
  if (!ytdl.validateURL(url)) return res.status(400).json({ error: 'Ungültige YouTube-URL' });

  try {
    const info = await ytdl.getInfo(url);
    const v = info.videoDetails;

    /* ---------- 1) Info-Action ---------- */
    if (req.query.action === 'info') {
      const muxed = info.formats.filter(f => f.hasVideo && f.hasAudio);
      const audio = info.formats.filter(f => f.hasAudio && !f.hasVideo)
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

      const vf = [], seen = new Set();
      for (const f of muxed) {
        const k = (f.qualityLabel || '') + '|' + (f.container || '');
        if (seen.has(k)) continue; seen.add(k);
        vf.push({
          itag: f.itag,
          quality: f.qualityLabel || f.quality || 'Video',
          container: f.container || 'mp4',
          fps: f.fps || null,
          size: f.contentLength ? parseInt(f.contentLength, 10) : null
        });
      }
      vf.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

      const af = [], aseen = new Set();
      for (const f of audio) {
        const k = (f.audioQuality || '') + '|' + (f.container || '');
        if (aseen.has(k)) continue; aseen.add(k);
        af.push({
          itag: f.itag,
          quality: (f.audioQuality || 'Audio').replace('AUDIO_QUALITY_', '').replace(/^\w/, c => c.toUpperCase()),
          bitrate: f.audioBitrate || null,
          container: f.container || 'mp4',
          size: f.contentLength ? parseInt(f.contentLength, 10) : null
        });
        if (af.length >= 4) break;
      }

      return res.status(200).json({
        title: v.title || '',
        author: (v.author && v.author.name) || '',
        duration: parseInt(v.lengthSeconds, 10) || 0,
        thumbnail: v.thumbnails && v.thumbnails.length ? v.thumbnails[v.thumbnails.length - 1].url : '',
        videoFormats: vf,
        audioFormats: af
      });
    }

    /* ---------- 2) Stream-Action ---------- */
    const itag = req.query.itag ? parseInt(req.query.itag, 10) : null;
    let fmt;
    if (itag) {
      fmt = info.formats.find(f => f.itag === itag);
      if (!fmt) return res.status(400).json({ error: 'Format nicht gefunden' });
    } else {
      fmt = info.formats.find(f => f.hasVideo && f.hasAudio) || info.formats[0];
    }

    const isAudio = fmt.hasVideo === false;
    const ext = isAudio ? 'm4a' : 'mp4';
    const safe = (v.title || 'video').replace(/[\\/:*?"<>|\n\r]/g, '_').slice(0, 100).trim() || 'video';
    const ascii = safe.replace(/[^\x20-\x7e]/g, '_');

    res.setHeader('Content-Type', isAudio ? 'audio/mp4' : 'video/mp4');
    if (fmt.contentLength) res.setHeader('Content-Length', fmt.contentLength);
    res.setHeader('Content-Disposition',
      `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(safe)}.${ext}`);

    const dl = ytdl.downloadFromInfo(info, { format: fmt });
    dl.on('error', e => {
      console.error('Stream error:', e);
      if (!res.headersSent) res.status(500).json({ error: String(e.message || e) });
      else res.end();
    });
    dl.pipe(res);
  } catch (e) {
    console.error('API error:', e);
    const msg = String(e.message || e);
    const status = /private|login/i.test(msg) ? 403 : /unavailable|not available/i.test(msg) ? 404 : 500;
    if (!res.headersSent) res.status(status).json({ error: msg });
  }
};
