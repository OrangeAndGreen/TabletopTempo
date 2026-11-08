# Tabletop Tempo

Slap the table, stomp your feet, and your phone shows your tempo and how steady you are, live.

Open https://orangeandgreen.github.io/TabletopTempo/ in Chrome on the phone, tap **Listen**, and allow the microphone.
"Add to Home screen" installs it as an app.

- **Live:** current BPM (last 8 hits), steadiness over the last 16 hits, how early or late the last hit was, and scrolling charts of the last 20 seconds.
- **Set tempo:** choose **Set tempo** under Mode and a target from 40 to 200 bpm, then tap Listen. The live card flashes four beats at that tempo and goes still; come in on the next beat. Each hit is matched to the nearest beat of that grid and shown as early or late in ms, and after Stop the **Against the target** numbers show drift from the target (mean offset), spread around it, typical miss from the grid, the trend in ms per minute and the tempo actually played. The count-in is silent because a click would be heard as a hit. **Free** (the default) works as before.
- **After Stop:** the whole session: average and fastest tempo, steadiness score, timing spread, drift, hands vs. feet lanes and a histogram of gaps.
- **History:** each session that has enough hits to score is saved when you tap Stop (start time, length, hits, average, fastest and slowest tempo, drift, steadiness, timing spread, settings, per-lane numbers when hands and feet are split, and the target numbers for a set-tempo session). The list shows past sessions newest first, and **Export** downloads them as a `.jsonl` file. The history lives in this browser's local storage on the phone only; clearing the site's data clears it.
- Nothing is recorded or uploaded. Audio is analyzed in the browser as it arrives and thrown away.

A single static page (`index.html`), no build step. GitHub Pages serves `master`.

## How it works

- Two bands: under 180 Hz (stomps) and over 1.2 kHz (slaps). A hit is a sudden rise in either band that stands clear of the background noise, confirmed 50 ms after it lands.
- Hands vs. feet: 2-means on the log ratio of high to low band energy, kept only when the two groups are well separated.
- Set tempo: the count-in is timed on the page clock and moved onto the audio clock by the smallest gap seen between the two, so pulses and hits share one timeline. Hits from half a beat before the first silent beat are scored against the nearest beat. The trend line unwraps offsets that slide past half a beat, so a player who drifts a whole beat away still reads as drifting.
- Steadiness: find the beat unit, follow it locally, compare every gap to the nearest allowed multiple (¼ to 8, plus 1½). Score = 100 − 4 × mean miss in percent.

## Testing

`node test/engine.test.js` runs the engine on a synthesized take and checks hit count, lane sorting, tempo, chunk-size independence and that pure noise gives no hits.

`node test/history.test.js` checks the session summary that goes into the history, and the storage format: one JSON object per line, only ever appended, with damaged lines skipped on reading.

`node test/target.test.js` checks set-tempo scoring: the BPM limits, the grid and count-in, each hit's nearest beat and early/late offset, the drift, spread and trend summary (including drift past half a beat), and the target numbers in the history record.
