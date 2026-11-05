# Tabletop Tempo

Slap the table, stomp your feet, and your phone shows your tempo and how steady you are, live.

Open https://orangeandgreen.github.io/TabletopTempo/ in Chrome on the phone, tap **Listen**, and allow the microphone.
"Add to Home screen" installs it as an app.

- **Live:** current BPM (last 8 hits), steadiness over the last 16 hits, how early or late the last hit was, and scrolling charts of the last 20 seconds.
- **After Stop:** the whole session: average and fastest tempo, steadiness score, timing spread, drift, hands vs. feet lanes and a histogram of gaps.
- Nothing is recorded or uploaded. Audio is analyzed in the browser as it arrives and thrown away.

A single static page (`index.html`), no build step. GitHub Pages serves `master`.

## How it works

- Two bands: under 180 Hz (stomps) and over 1.2 kHz (slaps). A hit is a sudden rise in either band that stands clear of the background noise, confirmed 50 ms after it lands.
- Hands vs. feet: 2-means on the log ratio of high to low band energy, kept only when the two groups are well separated.
- Steadiness: find the beat unit, follow it locally, compare every gap to the nearest allowed multiple (¼ to 8, plus 1½). Score = 100 − 4 × mean miss in percent.

## Testing

`node test/engine.test.js` runs the engine on a synthesized take and checks hit count, lane sorting, tempo, chunk-size independence and that pure noise gives no hits.
