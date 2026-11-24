# Nova

**Docs:** https://epsirho.github.io/Nova/ · **Package:** `StarFruit.Nova` · **License:** Apache-2.0

Nova is an audio feature extractor for C# (`net10.0`). It takes a track and measures what it sounds like: tempo, key, loudness, timbre and rhythm, as numbers you can store, compare or feed to a model.

It currently can compute:
- Replay gain
- BPM and beat positions
- Key, scale and tuning
- Average loudness and dynamic complexity
- Low-level descriptors: MFCC, GFCC, mel, ERB and Bark bands, spectral shape, spectral contrast and more, each summarised over the track
- Temporal features: beat grid, per-beat rows, onset patterns, swing, syncopation, tempo stability and song structure
- Onset and mel frame series for sequence models

Descriptor names and statistics follow the AcousticBrainz low-level layout, so Nova's output should line up with that dataset and anything trained on it (results wont be 1:1 though).

## Install

```bash
dotnet add package StarFruit.Nova
```

## Usage

```csharp
using Nova;

// The extractor holds no per-track state, so one instance can be reused for a whole library
var extractor = new FeatureExtractor();

// Decodes the file and runs every analysis on it
TrackFeatures f = extractor.Extract(@"D:\Music\track.flac");

Console.WriteLine($"{f.Bpm:F1} BPM, {f.Key.Key} {f.Key.Scale}"); // 128.0 BPM, A minor

// Low-level descriptors are looked up by name, each with its summary statistics
double[] mfccMeans = f.LowLevel["mfcc"].Mean;              // 13 values
double centroid = f.LowLevel["spectral_centroid"].Median[0];
```

There are two keys. `Key` follows the AcousticBrainz key profile, which is what models trained on that data expect. `MusicalKey` only uses true spectral peaks and is the better one for comparing keys between tracks, like for harmonic mixing.

## Audio input

Nova analyses mono float samples at 44.1 kHz, held in a `MonoSignal`. There are two ways to get them.

`Extract(path)` decodes the file with ffmpeg, through `AudioDecoder`. ffmpeg runs as its own process and needs to be on `PATH`, or have its full path in the `NOVA_FFMPEG` environment variable. It resamples with soxr and averages the channels.

`Extract(MonoSignal)` takes samples from any decoder instead, and doesn't need ffmpeg at all. For example, with NAudio, which decodes through Windows Media Foundation:

```csharp
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

using var reader = new AudioFileReader(path);

// Nova expects 44.1 kHz, so resample anything else
ISampleProvider source = reader.WaveFormat.SampleRate == 44100
    ? reader
    : new WdlResamplingSampleProvider(reader, 44100);

// Mix the channels down to mono by averaging them
int channels = reader.WaveFormat.Channels;
var mono = new List<float>();
var buffer = new float[16384 * channels];
int read;
while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
    for (int i = 0; i + channels <= read; i += channels)
    {
        float sum = 0;
        for (int c = 0; c < channels; c++) sum += buffer[i + c];
        mono.Add(sum / channels);
    }

var f = new Nova.FeatureExtractor().Extract(new Nova.Audio.MonoSignal(mono.ToArray(), 44100));
```

`AudioDecoder` can also decode just part of a file: `Decode(path, start: 30, seconds: 10)`.

## Temporal features

Turning on temporal features adds measurements in time order, on top of the track-level ones. The track-level values come out exactly the same either way.

```csharp
var f = new FeatureExtractor(temporal: true).Extract(@"D:\Music\track.flac");
var t = f.Temporal!;

// Check this first: the grid, patterns and bars mean nothing on ambient, speech or silence
if (t.Validity.Status == RhythmStatus.NoPulse) return;

double swing = t.Pattern.Swing8;
double drift = t.Tempo.Drift;
var sections = t.Structure.Sections;
```

What's in it:
- `BandOnsets`: onset strength in four bands (under 150 Hz, 150–800, 800–4,000, above 4,000) at 100 frames a second.
- `BeatSequence`: one row per beat with loudness, band onsets, spectral flux, centroid, chroma and MFCC.
- `BeatGrid`: bar starts and how confident the downbeat is. The grid assumes 4/4.
- `OnsetPattern`: every bar folded onto 16 and 48 steps in each band, each bar's own pattern, swing, syncopation and how clear the pattern is.
- `TempoStability`: how steady the beat is, drift, local BPM range, tempo changes and a 64-point BPM curve.
- `BarStructure`: chroma and timbre self-similarity between bars, novelty, sections and energy curves. It's built a row at a time, so long tracks don't need a huge matrix in memory.
- `ClockSeries`: one row a second, separate from the grid: loudness, band onsets, pulse strength, beat support, and spectral flatness and noisiness per band.
- `RhythmValidity`: `Pulse`, `Uncertain` or `NoPulse`, from the pulse strength and how much of the track the beats and bars cover.

Tracks over 30 minutes skip the temporal features (change it with `temporalMaxSeconds`). `TemporalFeatures.Compute(signal)` runs them on their own. The layout is versioned by `TemporalFeatures.SchemaVersion` (currently 4), so stored features from different versions aren't mixed up.

## Onset and mel frames

For models that read audio as a sequence, Nova can give frame series directly, at 100 frames a second:

```csharp
// Any MonoSignal works here, a whole track or a short window
var clip = new Nova.Audio.AudioDecoder().Decode(path, start: 30, seconds: 8);

// Onset strength in eight octave bands: 0, 100, 200, 400, 800, 1,600, 3,200 and 6,400 Hz
FrameSeries onsets = BandOnsets.Compute(clip, BandOnsets.EightBandEdges);

// 64 mel bands from 0 to 16 kHz, as log(1 + 10,000 · magnitude)
FrameSeries mel = MelFrames.Compute(clip);
```

## Accuracy

Checked on 10,801 tracks against AcousticBrainz's reference values for the same recordings:

| | Nova vs AcousticBrainz | Two AcousticBrainz submissions of the same recording |
|---|---|---|
| Low-level statistics (90th-percentile gap) | 0.02 standard deviations | 0.22 standard deviations |
| BPM within 1% | 97% (98% on lossless files) | 92% |
| Key | 81% | 88% |

BPM octave errors happen on 0.3% of tracks, mostly ambient and orchestral music with weak beats. On lossless files the beat positions are the same as AcousticBrainz's.

The temporal features were checked on 300 drum performances from the E-GMD dataset, against the MIDI that played them: beats reach a median F-score of 0.98 and swing correlates 0.88. Downbeats are right about half the time, since on drums alone beat 1 and beat 3 are hard to tell apart.

These numbers use the ffmpeg decoder. Another decoder gives the same samples for lossless 44.1 kHz files, and can shift results slightly for lossy files or other sample rates.
