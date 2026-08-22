# CAVIAR face-detector benchmark

This benchmark compares YuNet, SCRFD-2.5G-KPS and SCRFD-10G-KPS while holding
the project's person detector, FastTracker, face classifier, crop quality policy
and temporal aggregation fixed. The controlled profiles disable the body fallback
so the face detector's effect is not hidden by body predictions.

## Models and license

The two SCRFD files were extracted from the official InsightFace v0.7 model packs:

- `buffalo_m/det_2.5g.onnx` -> `artifacts/face_detector/scrfd_2.5g_kps.onnx`
- `buffalo_l/det_10g.onnx` -> `artifacts/face_detector/scrfd_10g_kps.onnx`

Checksums and upstream package URLs are recorded in
`models/face-detector-benchmark-assets.json`. Verify the local files with:

```powershell
.\.venv\Scripts\python.exe tools\prepare_production_assets.py `
  --manifest models\face-detector-benchmark-assets.json
```

InsightFace states that its pretrained models are available for non-commercial
research only unless a separate commercial license has been issued. Do not move
these benchmark assets into a commercial deployment without resolving that license.

## Metric definitions

| Metric | Exact benchmark definition |
| --- | --- |
| Person track coverage | CAVIAR visible GT person-box instances matched one-to-one to FastTracker boxes at IoU >= 0.50 / visible GT instances. |
| Face detection rate | Matched CAVIAR identities with at least one scheduled face attempt that produced a face / matched identities. A detected face rejected for size/quality still counts as detected. |
| Usable face coverage | Matched identities with at least one `candidate` crop passing minimum face width, landmark and configured quality gates / matched identities. |
| Unknown rate | Matched identities whose last matched end-to-end prediction is still `unknown` / matched identities. Body fallback is disabled. |
| Track stability | `1 - female<->male flips / consecutive known-label transitions`, matched by CAVIAR identity. Unknown states are reported separately and are not counted as gender flips. |
| p50 / p95 latency | CUDA-synchronized `pipeline.process_frame` latency; video decode, XML matching, direct size probes and report I/O are excluded. |
| FPS | Processed frames / summed synchronized end-to-end pipeline time. This is offline throughput, not source-rate playback. |

The report also includes identity coverage, attempt-level detection/usable rates,
tracker ID switches, face-stage latency and raw counts so percentages cannot hide
small denominators.

## Important CAVIAR limitation

CAVIAR supplies person boxes and person identities, but no face boxes. True face
recall by pixel size cannot be calculated from this dataset.

The requested Tiny/Small/Medium/Large output is therefore named
`face_size_recall_proxy`. On sampled visible GT instances it computes:

1. estimated face size = GT person height x 0.20;
2. Tiny `<16`, Small `[16,32)`, Medium `[32,64]`, Large `>64` pixels;
3. run the detector directly on the upper 55% of the GT person ROI;
4. proxy recall = ROIs with at least one face detection / probed ROIs.

This proxy measures face-evidence availability under the same video conditions.
It must not be presented as annotated detector recall. For true bucket recall, use
a face-box-labelled dataset or add reviewed face annotations to CAVIAR.

## Environment and commands

Install the CUDA 12.8-compatible ONNX Runtime build once:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-face-benchmark.txt
```

Short GPU smoke test on one sequence and 10 frames:

```powershell
.\.venv\Scripts\python.exe scripts\benchmark_face_detectors_caviar.py `
  --device cuda `
  --sequence EnterExitCrossingPaths1 `
  --max-frames-per-sequence 10 `
  --direct-probe-every-n-frames 1 `
  --output-dir artifacts\evaluation\face_detectors_caviar\smoke
```

Full benchmark on all ready CAVIAR sequences:

```powershell
.\.venv\Scripts\python.exe scripts\benchmark_face_detectors_caviar.py `
  --device cuda `
  --direct-probe-every-n-frames 1 `
  --progress-every-n-frames 50 `
  --output-dir artifacts\evaluation\face_detectors_caviar\full_gpu `
  --resume
```

`--resume` is safe to include on the first run: it creates the output directory
when absent. After every completed detector/sequence pair, the script atomically
writes `sequence_checkpoints/<sequence>.json`. If the benchmark is interrupted,
run the exact same command again; completed sequences are loaded rather than
processed again. The in-progress sequence starts again from its first selected
frame so tracker state remains valid. Changing any scoring/probe option causes a
clear checkpoint-signature error instead of mixing incompatible results.

A `KeyboardInterrupt` is therefore not a SCRFD or YOLO exception by itself. It
means the process received an interrupt while the currently shown Python line was
running. The script now catches it, prints the exact resume directory, and exits
without the long traceback.

The script refuses SCRFD CPU fallback during a normal run. Each output directory
contains per-sequence checkpoints and per-detector JSON reports plus:

- `face_detector_comparison.csv`
- `face_size_recall_proxy.csv`
- `benchmark_summary.json`
