# Báo cáo tổng hợp kiểm thử Crowd Tracking

**Ngày tổng hợp:** 2026-08-20  
**Phạm vi:** toàn bộ kết quả benchmark, smoke test, audit và lỗi đã được ghi nhận trong session chat này.  
**Mục tiêu:** đánh giá detector, tracker, nhánh face/body, realtime, analytics và mức sẵn sàng triển khai demo.

> Các số liệu không có ground truth chính thức được ghi rõ là proxy. Không diễn giải webcam continuity thành IDF1/HOTA/MOTA chính thức.

## 1. Kết luận điều hành

Pipeline hiện tại:

~~~text
YOLO11n -> FastTracker -> session-scoped person_id
        -> adaptive face/body attribute branch
        -> trajectory/spatial/classroom analytics
        -> local Gradio / FastAPI / WebRTC / Modal profile
~~~

Trạng thái hiện tại:

- Detector production: YOLO11n, imgsz=512, FP16/CUDA, detector confidence truyền vào tracker 0.05, evaluation confidence 0.20.
- Tracker production hiện tại: FastTracker native của Ultralytics 8.4.63, dùng bộ tham số ByteTrack tương thích và heuristic xử lý occlusion.
- Person identity: lớp person_id theo session, không phải biometric identity/ReID; bị xoá khi reset/expire session.
- Attribute: route thích nghi face -> body fallback; body không raw-logit-fuse với face.
- Analytics: speed, direction, dwell, stationary, zones/line, density, heatmap, IN/OUT và session history.
- Pose: kiến trúc đã sẵn sàng để bổ sung, nhưng chưa nên chạy thêm full-frame pose model song song với detector trong critical path.
- Test suite hiện tại: 221/221 pass với unittest discover -s tests -q, 7.631 giây.

Các kết luận chính:

1. YOLO11n phù hợp live demo hơn YOLO26n. YOLO26n trước đó chậm hơn khoảng 11.6% trên ba video webcam và tạo nhiều track fragmentation hơn.
2. FastTracker có lợi thế nhỏ hoặc tương đương ByteTrack tùy dataset. CAVIAR short-run cho FastTracker MOTA-proxy/recall nhỉnh hơn; MOT17 cached replay cho kết quả mixed. Chưa có cơ sở tuyên bố FastTracker luôn thắng.
3. DeepOCSORT + ReID chưa có lợi ích trên benchmark hiện tại. ReID làm ID switch tăng mạnh và latency giảm rõ rệt; ReID-off gần ByteTrack.
4. Bottleneck chính là YOLO detector + tracker, không phải face/body classifier hoặc drawing/analytics.
5. Unknown của face/body chủ yếu do chất lượng crop, confidence, temporal policy và track fragmentation; không phải batch limit hai người.
6. Webcam không có ground-truth identity nên chỉ dùng để đánh giá latency, continuity và coverage proxy. IDF1/HOTA/MOTA chính thức cần export MOTChallenge và chạy TrackEval.

## 2. Môi trường và model assets

### 2.1 Môi trường

| Thành phần | Giá trị |
|---|---|
| Ultralytics | 8.4.63 |
| PyTorch | 2.11.0+cu128 |
| CUDA | CUDA runtime 12.8, CUDA inference đã smoke-test |
| GPU | RTX 2050-class laptop GPU; một số run ghi CUDA device 0 |
| Runtime | .venv của project |
| Precision live | FP16 khi có CUDA, CPU fallback FP32 |
| Trackers | ByteTrack, FastTracker, DeepOCSORT/DeepOCSORT ReID |
| Face detector | YuNet face_detection_yunet_2023mar.onnx |
| Face classifier | MobileNetV3-Large |
| Body classifier | MobileNetV3-Small |

### 2.2 Assets production

~~~text
artifacts/person_detector/yolo11n.pt
artifacts/face_detector/face_detection_yunet_2023mar.onnx
artifacts/gender_classifier/face_gender_classifier_mobilenet_v3_large.pth
artifacts/body_gender_classifier/body_gender_classifier_mobilenet_v3_small.pth
~~~

Checkpoint body đã strict-load thành công vào torchvision.mobilenet_v3_small và forward CUDA thành công. Không dùng loader/transform face cho checkpoint body.

## 3. Cấu hình live baseline hiện tại

File baseline: configs/pipeline-live.yaml.

### 3.1 Detector/tracker

| Tham số | Giá trị |
|---|---:|
| Detector | YOLO11n |
| tracker_input_confidence | 0.05 |
| track_low_thresh | 0.10 |
| track_high_thresh | 0.40 |
| new_track_thresh | 0.50 |
| track_buffer | 45 frames |
| match_thresh | 0.80 |
| imgsz | 512 |
| max_det | 300 |
| IoU | 0.60 trên NMS path |
| FP16 | bật trên CUDA |
| max live frame width | 640 px |
| recovery | bật; boost 640 px sau 2 raw-empty frames, tối đa 3 frames, cooldown 45 |
| tracker production | configs/fasttrack-live.yaml |

tracker_input_confidence=0.05 là chủ ý: thấp hơn track_low_thresh=0.10 để FastTracker/ByteTrack thấy đầy đủ low-score association band. Đây không phải threshold báo precision trên UI.

FastTracker-specific defaults trong configs/fasttrack-live.yaml:

| Tham số | Giá trị |
|---|---:|
| reset_velocity_offset_occ | 5 |
| reset_pos_offset_occ | 3 |
| enlarge_bbox_occ | 1.1 |
| dampen_motion_occ | 0.5 |
| active_occ_to_lost_thresh | 10 |
| occ_cover_thresh | 0.7 |
| occ_reappear_window | 40 |
| init_iou_suppress | 0.7 |

FastTracker đã được xác nhận là FASTTracker native trong Ultralytics 8.4.63, không phải package FastTrack bên ngoài; không cần cài thêm dependency ReID.

### 3.2 Adaptive face/body

| Nhánh | Tham số chính |
|---|---|
| Router | adaptive, tuổi track tối thiểu 3, refresh 10 frame, hysteresis 2 frame |
| Face gate | estimated face ratio .20, face size tối thiểu 48 px, person height tối thiểu 100 px, upper ROI .55, full-body retry tắt |
| Face model | input 224, acceptance .75, min observations 3, max 5, stable .90, retry 5, success 8, refresh 90, tối đa 4 tracks/frame |
| Body model | input 256x128 letterbox, threshold .77, min crop 16x48, tối đa 4 tracks/frame |
| Body schedule | retry 4, success 4, unknown retry 20, resolved refresh 120 |
| Body temporal | min observations 2, max 3, stable .90; unknown không freeze vĩnh viễn |
| Fallback | face miss/uncertainty đủ điều kiện mới chuyển body; body không hợp nhất raw logits với face |

### 3.3 Analytics/UI

- Trajectory: velocity window 8 frames, stationary threshold 8 px/s, stationary duration 2 giây, history 60.
- Spatial: heatmap 16x12, decay .995, density scale 100000, zone history 300.
- Session history: snapshot mỗi 5 giây, tối đa 720 snapshot; flow windows 60/300 giây, tối đa 2000 event.
- Counting line mặc định từ (100,350) đến (500,350) trên reference 640x480.
- HUD/heatmap/trajectory overlay production đã giảm/tắt để không che video; motion labels vẫn bật.
- UI Gradio cũ dùng stream_every khoảng 0.15 s, concurrency 1 và always-last; giới hạn callback khoảng 6.7 Hz và bỏ frame cũ để giảm queue latency.

## 4. Kiểm thử checkpoint và attribute model

### 4.1 Body gender classifier / PA-100K

- Architecture: mobilenet_v3_small, khoảng 1,519,906 parameters.
- Role: body_visual_presentation.
- Labels: female, male.
- Semantics: visual presentation, không phải self-identified gender.
- Input: HxW 256x128.
- Preprocess: RGB, aspect-preserving resize, centered black letterbox, ImageNet mean/std.
- Temperature: 1.4940646887.
- Calibrated threshold: .77.
- Source dataset: PA-100K.
- PA-100K test: balanced accuracy 0.82484, F1 0.82641. Split không identity-disjoint hoàn toàn.
- Later PETA evaluation: balanced accuracy 0.734.
- Body model nhỏ hơn face MNV3-Large (4,204,594 params trong audit so sánh).

Kết quả load/forward:

- Strict-load vào MobileNetV3-Small: pass.
- CUDA forward output [N,2]: pass.
- Kiểm tra incompatibility với face wrapper MobileNetV3-Large: pass theo chiều “reject đúng”; checkpoint body không được dùng trong face loader.

Nhận xét: body model không có giới hạn hai người. Trong video bốn người, max_body_tracks_per_frame=4; cả bốn box có thể schedule. Unknown chủ yếu do crop chồng/lẫn, confidence dưới .77, yêu cầu nhiều observation và ID fragmentation.

### 4.2 Face classifier và probe ảnh close-up

Ảnh probe: C:\Users\MinhPham\Downloads\image.webp, 640x360.

- YuNet hoạt động: score khoảng .90-.94, face width khoảng 162-174 px, vượt gate .80/48 px.
- Router không skip face; box bottom-clipped được route FACE/truncated_face.
- Một số crop thủ công cho xác suất female khoảng .69-.74, thấp hơn acceptance .75; crop full-person thấp hơn.
- Horizontal TTA không cải thiện; probe top55 TTA khoảng .7013.
- Exact E2E tracker crop khi ép route refresh đã chạy face ở frame 3, 11, 19; sau 3 evidence resolve female confidence khoảng .785555 ở frame 19.
- Đây không phải YuNet không thấy mặt. Có hai vấn đề scheduler đã phát hiện: route cũ cập nhật last_attribute_route_frame mỗi frame nên route refresh không đến; route FACE bị crop/truncate không được body fallback.
- Không hạ global face threshold chỉ dựa trên ảnh này vì có crop probe nhận nhầm/không chắc.

### 4.3 Video bốn cô gái annotated.mp4

Thông tin: 640x360, 1203 frames, 48.12 giây, 25 FPS.

Quan sát:

- Detector/tracker nhìn thấy bốn box/ID; không có hard cap hai người.
- Hai track ngoài thường nhận body:female; hai track giữa giữ unknown.
- Body-only A/B và adaptive gần như giống nhau; face không phải nguyên nhân chính vì YuNet có attempts nhưng không có candidate hợp lệ.

Số liệu audit:

| Chỉ số | Kết quả |
|---|---:|
| Body attempts | 40 |
| Crop hợp lệ | 40 |
| Body inferences | 40 |
| Single-frame body confidence >= .77 | 18-19 |
| Body evidence updates | 40 |
| Body resolved updates ghi nhận | 11 |
| Face attempts adaptive | 38 |
| Face candidate hợp lệ | 0 |
| Final điển hình | 1 female + 3 unknown |

Nguyên nhân:

- PETA body BA chỉ .734.
- Hai người giữa overlap/contamination và crop kém hơn.
- Khoảng 34 local IDs, 23 IDs reappear; fragmentation chia evidence cho nhiều TrackState.
- Policy cũ freeze unknown sau 3 observation; policy mới chỉ freeze known và retry unknown mỗi 20 frame.

## 5. Detector benchmark

### 5.1 YOLO11n MOT17 resolution sweep

| Input profile | Detector FPS | Recall | AP50 | Nhận xét |
|---|---:|---:|---:|---|
| live-640 | 15.46 | 26.44% | 45.21% | phù hợp live nhưng recall thấp |
| source-960 | 15.20 | 46.31% | 61.05% | knee point tốt cho video độ phân giải cao |
| source-1280 | 13.05 | 54.98% | cao hơn source-960, precision giảm | không phù hợp webcam mặc định |

source-960 dành cho footage high-resolution/offline, không có nghĩa upscale webcam 640 lên 960.

### 5.2 YOLO26n detector-only

YOLO26n đã tải và smoke-test bằng Ultralytics 8.4.63. YOLO26n-pose cũng load được nhưng không dùng làm detector production.

MOT17, 3 sequences, 100 frames/sequence, live-640 tương đương:

| Mode | Predicted | Matches | FP | FN | Precision | Recall | AP50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| YOLO26n end-to-end | 2043 | 1609 | 434 | 5755 | .787567 | .218495 | .379930 |
| YOLO26n conventional OTM/NMS | 2213 | 1731 | 482 | 5633 | .782196 | .235062 | .410238 |

FPS theo sequence:

- E2E khoảng 15.71 / 13.926 / 5.84 FPS.
- OTM/NMS khoảng 19.528 / 21.441 / 6.923 FPS.
- Một repeat aggregate ghi khoảng 9.782 FPS E2E và 12.382 FPS OTM; bị chi phối bởi sequence chậm.

Kết luận: YOLO26n không cho lợi ích rõ trên live profile; recall thấp và tốc độ không ổn định trên sequence khó.

### 5.3 YOLO26n trực tiếp với ByteTrack

MOT17 3 sequences x100, YOLO26n imgsz512, input conf .05, max_det300, width640:

| Profile | IDSW | Recall | MOTA-proxy | Precision |
|---|---:|---:|---:|---:|
| B0 stability (.40/.10/.50) | 7 | .135524 | .108093 | .836547 |
| B1 recall-biased (.35/.10/.40) | 12 | .154128 | .121266 | .831502 |

B1 tăng recall nhưng IDSW tăng. Chưa có cơ sở thay YOLO11n trong live demo.

## 6. Tracker benchmark

### 6.1 YOLO11n + DeepOCSORT/ReID A/B trên MOT17

| Tracker | IDSW | Recall | MOTA-proxy | Ghi chú |
|---|---:|---:|---:|---|
| ByteTrack | 62 | 35.14% | 32.70% | baseline tốt nhất trong run |
| DeepOCSORT + ReID auto, appearance .90 | 150 | — | — | tệ hơn rõ |
| DeepOCSORT + use_byte=false | 150 | — | — | gần như không đổi |
| DeepOCSORT ReID-off | 62 | — | — | gần ByteTrack |
| DeepOCSORT ReID, appearance .95 | 84 | — | — | cải thiện nhưng vẫn thua ByteTrack |

Native feature hook/encoder đã xác nhận có đăng ký và hoạt động; ReID xấu không phải do silent fallback. Kết luận: ReID appearance hiện tại làm association tệ hơn trên footage này.

### 6.2 YOLO11n ByteTrack smoke lịch sử

| Profile | GT | Predicted | Matches | FP | FN | IDSW | MOTA-proxy | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 sequences x300, imgsz512, conf .25 | 23878 | 4771 | 4483 | 288 | 19395 | 34 | .174261 | .939635 | .187746 |
| source-960 | — | — | — | — | — | 62 | .327037 | .941744 | .351369 |

Hai run không hoàn toàn cùng protocol; dùng để so xu hướng.

### 6.3 Cached replay ByteTrack vs FastTracker

Cùng detection cache YOLO11n, chỉ thay tracker.

Cache live-640, 900 frames:

| Tracker | IDSW | Predicted | Matches | FP | FN | MOTA-proxy | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ByteTrack | 34 | 4771 | 4493 | 278 | 19385 | .175098 | .941731 | .188165 |
| FastTracker | 30 | 4768 | 4491 | 277 | 19387 | .175224 | .941904 | .188081 |

Cache source-960, 900 frames:

| Tracker | IDSW | Predicted | Matches | FP | FN | MOTA-proxy | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ByteTrack | 61 | 8909 | 8413 | 496 | 15465 | .329006 | .944326 | .352333 |
| FastTracker | 66 | 8918 | 8422 | 496 | 15456 | .329173 | .944382 | .352710 |

FastTracker giảm IDSW ở live-640 nhưng tăng ở source-960; MOTA gần như không đổi.

### 6.4 Direct MOT17 YOLO11n, 3 sequences x100

| Sequence | Byte IDSW | Fast IDSW | Byte recall | Fast recall | Byte MOTA | Fast MOTA |
|---|---:|---:|---:|---:|---:|---:|
| 02 | 1 | 1 | .147446 | .147446 | .142916 | .143328 |
| 04 | 0 | 0 | .110467 | .110467 | .081702 | .081702 |
| 05 | 6 | 5 | .392991 | .390488 | .317897 | .316646 |
| **Tổng** | **7** | **6** | **.153313** | **.153042** | **.127512** | **.127512** |

FastTracker ít hơn một IDSW nhưng recall giảm rất nhẹ và MOTA không đổi.

## 7. CAVIAR benchmark

Protocol:

- Sequences: EnterExitCrossingPaths1, OneLeaveShopReenter1, TwoEnterShop1.
- Tối đa 120 frame/sequence, tổng 360 frame.
- Visible-person MOT-style matching, IoU .5.
- Occluded GT là ignore region; annotation gap xử lý riêng.
- Full offline score xử lý mọi frame; source-FPS backpressure và UI cadence là mô phỏng riêng.
- YOLO11n, imgsz512, FP16, input conf .05, eval conf .20, max_det300.

### 7.1 CUDA smoke: smoke_cuda_20260811_004334

| Profile | Predicted | Matches | FP | FN | IDSW | MOTA-proxy | Precision | Recall | FPS | Mean ms | P95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ByteTrack | 774 | 774 | 0 | 108 | 0 | .877551 | 1.000000 | .877551 | 70.882 | 14.108 | 17.907 |
| FastTracker | 776 | 776 | 0 | 106 | 0 | .879819 | 1.000000 | .879819 | 69.058 | 14.480 | 18.835 |
| DeepOCSORT auto | 774 | 774 | 0 | 108 | 0 | .877551 | 1.000000 | .877551 | 65.877 | 15.180 | 19.172 |
| DeepOCSORT ReID | 774 | 774 | 0 | 108 | 0 | .877551 | 1.000000 | .877551 | 32.827 | 30.463 | 46.981 |

- IDSW bằng 0 cho cả bốn profile trên đoạn đã chọn.
- FastTracker nhỉnh hơn ByteTrack 2 predicted boxes/2 FN và MOTA-proxy +0.002268, nhưng chậm hơn khoảng 2.6%.
- DeepOCSORT ReID chậm hơn hơn 2 lần.
- UI cadence giả lập stream_every=150 ms bỏ 264/360 frame (73.33%) dù worker offline gần như không drop.

Chi tiết theo sequence của run này:

| Profile/sequence | GT | Pred | Match | FP | FN | IDSW | MOTA | FPS | Mean ms | P95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Byte/EnterExitCrossingPaths1 | 325 | 267 | 267 | 0 | 58 | 0 | .821538 | 67.377 | 14.842 | 19.825 |
| Byte/OneLeaveShopReenter1 | 16 | 9 | 9 | 0 | 7 | 0 | .562500 | 75.721 | 13.206 | 17.746 |
| Byte/TwoEnterShop1 | 541 | 498 | 498 | 0 | 43 | 0 | .920518 | 70.051 | 14.275 | 17.488 |
| Fast/EnterExitCrossingPaths1 | 325 | 269 | 269 | 0 | 56 | 0 | .827692 | 68.170 | 14.669 | 18.940 |
| Fast/OneLeaveShopReenter1 | 16 | 9 | 9 | 0 | 7 | 0 | .562500 | 74.361 | 13.448 | 16.976 |
| Fast/TwoEnterShop1 | 541 | 498 | 498 | 0 | 43 | 0 | .920518 | 65.256 | 15.324 | 21.339 |
| Deep auto/EnterExitCrossingPaths1 | 325 | 267 | 267 | 0 | 58 | 0 | .821538 | 64.657 | 15.466 | 18.651 |
| Deep auto/OneLeaveShopReenter1 | 16 | 9 | 9 | 0 | 7 | 0 | .562500 | 73.404 | 13.623 | 17.418 |
| Deep auto/TwoEnterShop1 | 541 | 498 | 498 | 0 | 43 | 0 | .920518 | 60.792 | 16.450 | 19.707 |
| Deep ReID/EnterExitCrossingPaths1 | 325 | 267 | 267 | 0 | 58 | 0 | .821538 | 29.968 | 33.369 | 40.813 |
| Deep ReID/OneLeaveShopReenter1 | 16 | 9 | 9 | 0 | 7 | 0 | .562500 | 58.571 | 17.073 | 28.401 |
| Deep ReID/TwoEnterShop1 | 541 | 498 | 498 | 0 | 43 | 0 | .920518 | 24.422 | 40.947 | 49.856 |

### 7.2 CUDA/GPU verified rerun

Run smoke_cuda_gpu_verified trên 360 frame:

| Profile | Tracking FPS | Mean latency | Source-budget drops |
|---|---:|---:|---:|
| ByteTrack | 16.696 | 59.894 ms | 107/360 (29.72%) |
| FastTracker | 17.749 | 56.340 ms | 100/360 (27.78%) |
| DeepOCSORT auto | 19.781 | 50.553 ms | 89/360 (24.72%) |

Run này có runtime/cold-state khác run 7.1; không xếp hạng tuyệt đối cùng bảng. Nó cho thấy latency variance lớn theo GPU state/runner/budget.

### 7.3 DeepOCSORT ReID provider validation

| Run | Frames | IDSW | MOTA/Prec/Recall | FPS | Mean ms | P95 ms | Worker drops |
|---|---:|---:|---:|---:|---:|---:|---:|
| reid_gpu_validation | 10 | 0 | 1/1/1 | 2.831 | 353.269 | 421.094 | 7/10 |
| reid_gpu_validation_cuda0 | 10 | 0 | 1/1/1 | 2.217 | 451.105 | 583.733 | 8/10 |
| reid_cuda_provider_verified | 5 | 0 | 1/1/1 | .539 | 1853.843 | 4868.588 | 3/5 |

Đây là backend smoke, không phải quality benchmark. ReID chạy thật nhưng latency không phù hợp live.

### 7.4 Detector recovery smoke

FastTracker, CAVIAR, 15 frame:

- GT/predicted/matches: 30/30/30.
- FP/FN/IDSW: 0/0/0.
- MOTA/precision/recall: 1/1/1.
- FPS 11.987; mean 83.421 ms; p50 76.641 ms; p95 139.394 ms; max 189.111 ms.
- Worker processed 8/15, dropped 7/15; stream cadence selected 4/15.

Chỉ là smoke để xác nhận recovery không exception và giữ match trên đoạn ngắn; không đủ chứng minh recovery cải thiện recall.

## 8. Webcam/local video benchmark

### 8.1 Ba video webcam, 120 frame/clip

Các clip local trong test_data/webcam, report gọi là EnterExit, OneLeave và WalkBy.

YOLO11n + ByteTrack:

| Clip | FPS | Mean ms | P95 ms | Segments |
|---|---:|---:|---:|---:|
| Clip 1 | 14.778 | — | 89.278 | 7 |
| Clip 2 | 16.237 | — | 78.695 | 1 |
| Clip 3 | 13.844 | — | 91.195 | 6 |
| **Aggregate** | **14.889** | **65.836** | **86.389 avg** | **14** |

YOLO11n + FastTracker:

| Clip | FPS | Mean ms | P95 ms | Segments |
|---|---:|---:|---:|---:|
| Clip 1 | 13.168 | 74.526 | 101.833 | — |
| Clip 2 | 14.885 | 65.844 | 85.894 | — |
| Clip 3 | 14.547 | 67.407 | 90.490 | — |
| **Aggregate** | **14.160** | **69.259** | **92.739 avg** | **14** |

FastTracker chậm hơn ByteTrack khoảng 4.9% FPS, p95 tương đương, segments không đổi. Đây là webcam proxy không có GT identity.

YOLO26n conventional vs YOLO11n:

| Detector | Aggregate FPS | Mean ms | P95 trung bình | Segments |
|---|---:|---:|---:|---:|
| YOLO11n | 14.889 | 65.836 | 86.389 | 14 |
| YOLO26n | 13.163 | 74.803 | 100.162 | 25 |

YOLO26n chậm hơn khoảng 11.6%, p95 xấu hơn và fragmentation tăng.

### 8.2 YOLO26n full three-video stability

| Clip | Frames | FPS | Mean ms | P95 ms | Segments |
|---|---:|---:|---:|---:|---:|
| EnterExit | 383 | 13.424 | 73.552 | 101.716 | — |
| OneLeave | 390 | 14.100 | 70.031 | 98.750 | — |
| WalkBy | 2360 | 11.881 | 83.196 | 109.508 | — |
| **Aggregate** | **3133** | **12.295** | **75.593** | **103.325 avg** | **211** |

### 8.3 DanceTrack validation và latency

Các clip validation đã chọn:

- dancetrack0004.mp4: 1080p, 48.12 s, khoảng 18.7 MB.
- dancetrack0019.mp4: 720p, 96.08 s, khoảng 23.8 MB.
- dancetrack0090.mp4: 1080p, 40.16 s, khoảng 22.6 MB.

CUDA profile DanceTrack0019, 120 frame, pipeline DeepOCSORT cũ:

| Stage | Mean | P95 |
|---|---:|---:|
| Detector + DeepOCSORT | 71.09 ms | 98.49 ms |
| YuNet/candidate | 33.34 ms | 84.45 ms |
| Drawing | 2.87 ms | — |
| End-to-end | 124.72 ms | 193.98 ms |

60 frame đầu:

- 188 face attempts, khoảng 3.13 attempt/frame.
- 0 face candidate hợp lệ.
- 177 yunet.detect trong 30 frame đầu, khoảng 5.9 call/frame vì upper ROI + full-person retry cũ.

Đây là bằng chứng cho việc giảm full-person YuNet fallback và tăng retry interval để tối ưu FPS.

CUDA blocking profile dancetrack0004.mp4, 60 frame, source 1920x1080/25 FPS:

- Initial/non-blocking audit: elapsed 25.053 s, processing 2.395 FPS, realtime factor .096.
- CUDA-blocking audit: elapsed 28.696 s, processing 2.091 FPS, realtime factor .084.
- GPU memory peak khoảng 67.6 MiB.
- Final timing: tracking 169.85 ms, total 181.21 ms, p50 186.90 ms, p95 308.37 ms.
- Detector recovery: raw candidate frames 60/60, empty 0, boost activation 0.
- Đây là source 1080p + blocking/profile overhead, không đại diện webcam 640; nhưng xác nhận detector/tracker là bottleneck.

### 8.4 Current webcam smoke finalised

Clip EnterExitCrossingPaths1cor.mpeg, 20 real frames + tail blank 61, criteria pass (min source 15, min FPS 5, max p95 350):

| Tracker | FPS | Mean ms | P95 ms | Max ms | Track count | Segments |
|---|---:|---:|---:|---:|---:|---:|
| ByteTrack | 11.808 | 84.041 | 117.421 | 132.350 | 2 | 2 |
| DeepOCSORT ReID | 10.276 | 96.506 | 129.255 | 141.985 | 2 | 2 |
| FastTracker | 12.944 | 76.696 | 104.515 | 123.264 | 2 | 2 |

Run smoke tương tự trước khi thêm tail blank có pass flag false vì tail_blank=0 nhưng xu hướng giữ nguyên:

- ByteTrack: 11.469 FPS, mean 86.473 ms, p95 118.489 ms.
- DeepOCSORT ReID: 10.324 FPS, mean 96.233 ms, p95 122.690 ms.
- FastTracker: 11.722 FPS, mean 84.662 ms, p95 118.525 ms.

### 8.5 Current 60-frame latency/analytics

dancetrack0004, FastTracker + YOLO11n current profile:

- Final tracking 169.85 ms, total 181.21 ms, p50 186.9, p95 308.37 ms, final processing FPS 5.52.
- Active person identity 2; unique session IDs 9; recovered bindings 3; ambiguous rejection 0; continuity breaks 0; retained inactive 7.
- Final attributes: active unknown 2/source unknown 2, coverage 0%.
- Router cumulative: face routes 2, body routes 5, unknown routes 6.
- Face: 4 attempts, 0 valid candidate; no_face=1, face_too_small=3; 0 classifier inference.
- Body: 15 attempts, 15 valid crops, 15 inferences, 8 threshold hits, 15 evidence updates, 3 resolved updates.
- Trajectory: 2 moving tracks; speed samples khoảng 70.48 và 52.31 camera-plane px/s.
- Spatial: confirmed density 1, density khoảng .326/100k px, floor area 64 m², people/m² .016; heatmap peak [9,9], value 18.628.
- Classroom status aspect_ratio_mismatch vì frame 640x360 khác reference 640x480; seat geometry chưa trace.

## 9. Realtime bottleneck audit

1. YOLO.track(), gồm detector + tracker, là stage lớn nhất.
2. Adaptive webcam reports cho tracking khoảng 96-99% stage timing frame cuối; ví dụ 60.94/61.67 ms, 65.04/66.35 ms và 16.92/17.27 ms tùy clip.
3. CAVIAR short clips có tracking khoảng 12-24 ms; source 1080p DanceTrack có thể lên 169.85 ms.
4. Face detection/classifier không phải steady-state bottleneck vì router giới hạn và nhiều clip remote không có candidate.
5. Body classifier được schedule thưa; không nên chạy batch lớn mỗi frame. MobileNetV3-Small body trên RTX2050 batch 1 khoảng 33-38 ms sau warmup; cold shape-specific forward có thể 5-7 giây. Warmup cả batch size 1 và max batch đã loại bỏ stall đầu.
6. Drawing/analytics thường dưới 1-3 ms.
7. UI/browser cadence có thể làm người dùng cảm thấy chậm hơn model: stream_every=0.15, concurrency 1, always-last bỏ frame cũ.

## 10. Pose estimation readiness

### 10.1 YOLO26n-pose smoke

- Weight yolo26n-pose.pt tải được từ official release vào temp; file smoke khoảng 7,878,574 bytes.
- Ultralytics nhận task pose.
- CUDA FP16 predict chạy thành công, output keypoints (N,17,3).
- model.track với ByteTrack chạy API.
- Một ảnh test có 3 người/keypoints nhưng confidence .20-.33, dưới new_track_thresh=.50, nên ID có thể None nếu giữ threshold.
- DanceTrack frame 100: imgsz512 có lúc 0/1 detection; imgsz960 tìm được 2 người (.833, .419). Cần calibrate trước khi thay detector.

### 10.2 Đánh giá kỹ thuật

- YOLO11n-pose khoảng 7.4 GFLOPs/2.9M params so với YOLO11n khoảng 6.5 GFLOPs/2.6M; pose nặng hơn.
- ByteTrack không dùng keypoints cho association; đổi pose head không tự động giảm IDSW.
- Pose hữu ích cho skeleton, posture, foot/hip anchor và analytics, không tự động giải quyết identity.
- Không chạy full-frame pose model thứ hai mỗi frame cạnh YOLO11n vì detector/tracker đã là bottleneck.
- Cách an toàn: một YOLO pose tracker duy nhất nếu benchmark latency/recall chấp nhận được, hoặc schedule pose sparse trên confirmed tracks/crops.
- Pose production nên enabled=false mặc định, cadence 5-10 frame, tối đa 2-4 track/frame, có last-good skeleton và expiry.

## 11. Unit, integration và contract tests

### 11.1 Kết quả hiện tại

Lệnh chạy lại ngày 2026-08-20:

~~~powershell
.\\.venv\\Scripts\\python.exe -m unittest discover -s tests -q
~~~

Kết quả:

~~~text
Ran 221 tests in 7.631s
OK
~~~

Nhóm test đã có:

- YAML schema và tracker config.
- ByteTrack, FastTracker, DeepOCSORT backend availability.
- FastTracker specialised keys/range validation.
- Detector profile, low-score recovery band, conf=.05 contract.
- Runtime warmup và body batch warmup shape 1/max.
- Body checkpoint strict load, metadata, resize-pad, temperature/threshold.
- Face/body batch mapping, cap, retry interval, round-robin.
- Face-first/body-fallback, face override body, cấm raw-logit fusion.
- Adaptive router geometry gates, route hysteresis và route refresh regression.
- TrackState lifecycle, unknown retry, freeze/refresh, prune/finalize.
- Person identity session isolation, reassociation, ambiguity rejection.
- Trajectory speed, direction, dwell, stationary.
- Spatial zones, density, heatmap, IN/OUT.
- CAVIAR parser, occlusion ignore, annotation gaps, cadence/drop simulation.
- MOT17 detector/ID-switch evaluation và cached tracker replay.
- Webcam validation, Video I/O, app/API/WebRTC/session cleanup.
- Classroom layout, seat assignment boundary và aspect-ratio status.

Các mốc pass lịch sử trong session trước khi test suite mở rộng:

| Giai đoạn | Kết quả |
|---|---:|
| Phase đầu | 30/30 pass |
| Phase lifecycle/runtime tiếp theo | 70/70 pass |
| Phase tracker/API tiếp theo | 72/72 pass |
| FastTracker integration | 73/73 pass |
| Test suite hiện tại | 221/221 pass |

### 11.2 Lỗi lịch sử và trạng thái

- Có run trước báo WebRTCApiTests.test_failed_connection_closes_its_own_tracker_session do asyncio.gather nhận Future khác event loop trong src/api/webrtc.py. Chạy lại hiện tại 221 test OK; lỗi được xem là đã sửa hoặc không còn tái hiện.
- PA-100K manifest ban đầu có split='' cho 100000 dòng:

~~~text
ValueError: Split không hợp lệ: ['']
ValueError: Manifest có 100000 dòng trống ở split.
~~~

Đây là lỗi data preparation, không phải lỗi model. Cần DATA_MODE=pa100k_archives hoặc điền train/val/calibration/test cho mọi dòng.
- Từng gặp WinError 2 khi upload video; nguyên nhân subprocess/codec path không tồn tại. Cần giữ test Windows codec/ffmpeg trên máy demo.
- Từng gặp h11 LocalProtocolError: Too little data for declared Content-Length khi response/video stream bị cắt; đây là transport error, không phải detector/tracker metric.

## 12. Đánh giá các nhánh analytics

| Nhánh | Trạng thái | Đánh giá |
|---|---|---|
| Attribute face | Có | YuNet + MNV3-Large, router/evidence/coverage |
| Attribute body | Có | MNV3-Small, letterbox riêng, fallback temporal |
| Trajectory speed | Có | camera-plane px/s, chưa phải m/s |
| Direction | Có | vector/label theo trajectory |
| Dwell time | Có | session/track lifecycle |
| Stationary | Có | velocity threshold + duration |
| Zones | Có | cần polygon camera-specific |
| Density | Có | confirmed count / area scale; cần calibration để gọi people/m² |
| Heatmap | Có | bounded 16x12, decay |
| IN/OUT | Có | counting line, cần kiểm tra từng camera |
| Classroom/seat | Có API/schema | chưa assign nếu chưa trace seat polygon |
| Pose | Chưa bật production | readiness audit, cần single-pass benchmark |

Speed/density/people_per_m2 hiện là camera-plane/calibrated metrics. Không trình bày như đơn vị vật lý chính xác nếu chưa camera calibration.

## 13. Artifact và file kết quả

Các thư mục chính:

~~~text
artifacts/evaluation/caviar/smoke_cuda_20260811_004334/
artifacts/evaluation/caviar/smoke_cuda_gpu_verified/
artifacts/evaluation/caviar/reid_gpu_validation/
artifacts/evaluation/caviar/reid_gpu_validation_cuda0/
artifacts/evaluation/caviar/reid_cuda_provider_verified/
artifacts/evaluation/caviar/detector_recovery_smoke/
artifacts/evaluation/webcam_ab_smoke/
artifacts/evaluation/webcam_ab_smoke_finalized/
artifacts/evaluation/webcam_latency_audit_20260815/
artifacts/evaluation/webcam_latency_cuda_blocking_20260815/
artifacts/body_gender_classifier/
configs/pipeline-live.yaml
configs/bytetrack-live.yaml
configs/fasttrack-live.yaml
configs/pipeline-fasttrack.yaml
~~~

Report JSON quan trọng:

- artifacts/evaluation/caviar/smoke_cuda_20260811_004334/caviar_tracking_comparison.json
- artifacts/evaluation/caviar/smoke_cuda_gpu_verified/caviar_tracking_comparison.json
- artifacts/evaluation/caviar/reid_gpu_validation/caviar_tracking_comparison.json
- artifacts/evaluation/caviar/reid_gpu_validation_cuda0/caviar_tracking_comparison.json
- artifacts/evaluation/caviar/reid_cuda_provider_verified/caviar_tracking_comparison.json
- artifacts/evaluation/caviar/detector_recovery_smoke/caviar_tracking_comparison.json
- artifacts/evaluation/webcam_ab_smoke_finalized/bytetrack/webcam_stability_report.json
- artifacts/evaluation/webcam_ab_smoke_finalized/deepocsort_reid/webcam_stability_report.json
- artifacts/evaluation/webcam_ab_smoke_finalized/fasttrack/webcam_stability_report.json
- artifacts/evaluation/webcam_latency_cuda_blocking_20260815/dancetrack0004_report.json

## 14. Cách tái lập benchmark chính

### Unit tests

~~~powershell
.\\.venv\\Scripts\\python.exe -m unittest discover -s tests -q
~~~

### Local app

~~~powershell
.\\.venv\\Scripts\\python.exe app.py
~~~

app.py đọc profile/classroom production theo README hiện tại; kiểm tra configs/pipeline-classroom-template.yaml nếu cần đổi room. pipeline-live.yaml là fixed-webcam baseline của các benchmark trước.

### Cached MOT17 tracker replay

~~~powershell
.\\.venv\\Scripts\\python.exe scripts/replay_mot17_cached_tracker.py --confidence .05 --match-iou .50 --tracker-config configs/bytetrack-live.yaml

.\\.venv\\Scripts\\python.exe scripts/replay_mot17_cached_tracker.py --confidence .05 --match-iou .50 --tracker-config configs/fasttrack-live.yaml
~~~

### Direct MOT17

~~~powershell
.\\.venv\\Scripts\\python.exe scripts/evaluate_mot17_id_switches.py --device cuda --detector-model yolo11n.pt --detector-imgsz 512 --detector-input-confidence .05 --detector-max-det 300 --max-frame-width 640 --max-frames 300 --tracker-config configs/bytetrack-live.yaml
~~~

Đổi tracker config sang configs/fasttrack-live.yaml để A/B; không đổi detector, input, frame range hoặc confidence trong cùng so sánh.

### Webcam validation

~~~powershell
.\\.venv\\Scripts\\python.exe scripts/validate_webcam_demo.py --device cuda --config configs/pipeline-live.yaml --tracker-config configs/fasttrack-live.yaml --detector-model yolo11n.pt --detector-input-confidence .05 --evaluation-confidence .20 --detector-imgsz 512 --detector-max-det 300 --max-frame-width 640 --minimum-source-frames 120 --max-source-frames 120 --strict
~~~

## 15. Quyết định triển khai và việc còn lại

### Các kiểm thử đã thực hiện nhưng chưa có metric aggregate

Các hạng mục sau đã được chạy hoặc audit trong session nhưng không có một con số accuracy tổng hợp đủ tin cậy để đưa vào bảng xếp hạng:

- Face fine-tune notebook: notebook/loader/split contract đã được tạo; session không ghi nhận một face test set identity-disjoint hoàn chỉnh, vì vậy không gán accuracy tổng quát cho face checkpoint mới. Các số có thể kiểm chứng hiện tại là probe ảnh và E2E temporal resolve ở mục 4.2.
- Pose estimator: YOLO26n-pose API/CUDA smoke pass, nhưng chưa có benchmark HOTA/IDSW/pose mAP trên tập pose có ground truth. Không được coi là pose model đã cải thiện tracking.
- CAVIAR full CUDA setup/full-run logs: các file setup/full run được lưu để chẩn đoán môi trường; các bảng chính chỉ dùng report JSON có đủ sequence/matching/performance fields.
- DanceTrack validation: ba clip validation đã tải/chọn để test pipeline và latency; không có MOT ground truth được ghép vào pipeline hiện tại nên không báo IDSW chính thức từ ba clip này.
- Webcam local: segments/unique IDs là continuity proxy, không phải identity accuracy.
- Detector recovery: smoke chứng minh không exception và giữ match trên đoạn ngắn; chưa có A/B đủ dài để chứng minh recovery tăng recall.
- Classroom/seat: schema/API pass, nhưng frame 640x360 không khớp reference 640x480 và chưa trace seat polygons; các số occupancy/seat không phải kết quả calibration hoàn chỉnh.
- FastTracker CAVIAR và MOT17: một số smoke run ngắn có IDSW bằng 0 hoặc rất ít; cần full sequence/multiple seeds để kết luận thống kê ổn định.

### Đã chốt cho demo

- Giữ YOLO11n thay YOLO26n trong live path.
- Giữ FastTracker làm profile production hiện tại nhưng vẫn giữ ByteTrack để baseline/A-B.
- Không đưa DeepOCSORT + ReID vào critical path.
- Giữ detector imgsz512, width640 cho webcam; source-960 dành cho high-resolution/offline benchmark.
- Dùng face-first/body-fallback với cooldown, unknown retry và batch cap.
- Bật detector recovery có giới hạn; không boost liên tục.
- Tắt telemetry chi tiết trong live vì copy tensor CPU làm chậm.
- Pose chỉ bật sau benchmark single-pass và phải toggleable.

### Cần làm tiếp

1. Chạy FastTracker vs ByteTrack trên cùng protocol hiện tại với full CAVIAR/MOT17 và báo p50/p95 tracker-only.
2. Export MOTChallenge chuẩn và chạy TrackEval để có HOTA/IDF1/MOTA chính thức thay MOTA-proxy.
3. Thu close/mid-distance webcam có ground truth gender presentation để calibrate face threshold/crop và body fallback.
4. Đánh giá PETA theo identity-disjoint split; không dùng BA .734 như chất lượng cho mọi camera.
5. Thu telemetry body/face theo geometry bucket và outcome transition để tách crop failure khỏi low confidence.
6. Benchmark pose single-pass YOLO pose so với YOLO11n trên cùng webcam/MOT17; không chạy hai full-frame detector song song trước khi có latency budget.
7. Trace seat polygons/reference geometry; hiện frame 640x360 gây aspect_ratio_mismatch với reference 640x480.
8. Kiểm tra ffmpeg/codec và WebRTC transport trên máy deploy để tránh WinError 2 hoặc Content-Length truncation.
9. Giới hạn/TTL session và GPU pipeline nếu mở nhiều client.

## 16. Kết luận cuối

Cấu hình hợp lý nhất cho demo realtime:

~~~text
YOLO11n (512, FP16, input conf .05)
+ FastTracker hoặc ByteTrack A/B
+ session person_id, không phải biometric ReID
+ face -> body fallback có temporal retry
+ trajectory/spatial analytics
+ WebRTC/FastAPI/Modal với latest-frame policy
~~~

Kết quả hiện có đủ để triển khai demo có kiểm soát, nhưng chưa đủ để khẳng định:

- gender presentation chính xác trong mọi khoảng cách, ánh sáng và occlusion;
- FastTracker luôn tốt hơn ByteTrack;
- YOLO26n tốt hơn YOLO11n;
- pose sẽ làm giảm ID-switch;
- density/speed đã là đơn vị vật lý nếu chưa calibration.

Các kết luận mạnh nhất được hỗ trợ bởi benchmark: YOLO11n hiện phù hợp live hơn YOLO26n; DeepOCSORT ReID chưa đáng đưa vào critical path; detector/tracker là bottleneck; face/body unknown là vấn đề coverage/quality/temporal policy; và test suite hiện tại xanh 221/221.
