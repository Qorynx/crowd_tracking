"""Face-detector adapters that preserve the runtime's YuNet-style output contract.

The SCRFD decoder follows InsightFace's public ONNX implementation, while
keeping ONNX Runtime optional for the production YuNet profile.  The adapter
returns one row per face in OpenCV FaceDetectorYN order:

``x, y, width, height, five (x, y) landmarks, confidence``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import cv2
import numpy as np


class ScrfdFaceDetector:
    """InsightFace SCRFD ONNX adapter with explicit execution-provider checks."""

    def __init__(
        self,
        model_path: str | Path,
        *,
        score_threshold: float,
        nms_threshold: float = 0.4,
        input_size: tuple[int, int] = (640, 640),
        providers: Sequence[str] = ("CUDAExecutionProvider", "CPUExecutionProvider"),
        require_cuda: bool = False,
    ) -> None:
        path = Path(model_path).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"SCRFD model not found: {path}")
        if not 0.0 < float(score_threshold) < 1.0:
            raise ValueError("SCRFD score_threshold must be in (0, 1).")
        if not 0.0 < float(nms_threshold) < 1.0:
            raise ValueError("SCRFD nms_threshold must be in (0, 1).")
        width, height = (int(value) for value in input_size)
        if width < 32 or height < 32 or width % 32 or height % 32:
            raise ValueError("SCRFD input_size dimensions must be multiples of 32 and at least 32.")

        try:
            import onnxruntime as ort
        except ImportError as error:
            raise RuntimeError(
                "SCRFD requires onnxruntime-gpu. Install requirements-face-benchmark.txt."
            ) from error

        requested_providers = [str(value) for value in providers]
        if not requested_providers:
            raise ValueError("SCRFD providers cannot be empty.")
        if require_cuda and "CUDAExecutionProvider" not in requested_providers:
            raise ValueError("SCRFD require_cuda=true requires CUDAExecutionProvider.")

        # ORT can reuse the CUDA/cuDNN DLLs shipped with the project's PyTorch
        # build. Importing torch happens before this adapter in ModelRuntime.
        preload_dlls = getattr(ort, "preload_dlls", None)
        if callable(preload_dlls) and "CUDAExecutionProvider" in requested_providers:
            preload_dlls()

        available = set(ort.get_available_providers())
        unavailable = [value for value in requested_providers if value not in available]
        if require_cuda and "CUDAExecutionProvider" not in available:
            raise RuntimeError(
                "ONNX Runtime CUDAExecutionProvider is unavailable; refusing a CPU fallback benchmark. "
                f"Available providers: {sorted(available)}"
            )
        effective_request = [value for value in requested_providers if value in available]
        if not effective_request:
            raise RuntimeError(
                f"None of the requested ONNX Runtime providers are available: {requested_providers}"
            )

        session_options = ort.SessionOptions()
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(
            str(path),
            sess_options=session_options,
            providers=effective_request,
        )
        active_providers = list(self.session.get_providers())
        if require_cuda and (not active_providers or active_providers[0] != "CUDAExecutionProvider"):
            raise RuntimeError(
                "SCRFD did not activate CUDAExecutionProvider first; refusing an invalid GPU benchmark. "
                f"Active providers: {active_providers}"
            )

        self.model_path = path
        self.score_threshold = float(score_threshold)
        self.nms_threshold = float(nms_threshold)
        self.input_size = (width, height)
        self.requested_providers = tuple(requested_providers)
        self.active_providers = tuple(active_providers)
        self.require_cuda = bool(require_cuda)
        self._last_roi_input_size = self.input_size
        self._center_cache: dict[tuple[int, int, int, int], np.ndarray] = {}

        input_config = self.session.get_inputs()[0]
        self.input_name = input_config.name
        self.output_names = [output.name for output in self.session.get_outputs()]
        output_count = len(self.output_names)
        if output_count == 9:
            self.feature_strides = (8, 16, 32)
            self.num_anchors = 2
            self.feature_map_count = 3
            self.use_keypoints = True
        elif output_count == 15:
            self.feature_strides = (8, 16, 32, 64, 128)
            self.num_anchors = 1
            self.feature_map_count = 5
            self.use_keypoints = True
        elif output_count in {6, 10}:
            raise ValueError(
                f"SCRFD model {path.name} has no five-keypoint outputs ({output_count} outputs)."
            )
        else:
            raise ValueError(
                f"Unsupported SCRFD output layout: expected 9 or 15 outputs, found {output_count}."
            )

    def setInputSize(self, size: tuple[int, int]) -> None:  # noqa: N802 - OpenCV compatibility
        """Accept YuNet's per-ROI call while retaining the configured SCRFD canvas."""

        width, height = (int(value) for value in size)
        if width < 1 or height < 1:
            raise ValueError("Face ROI dimensions must be positive.")
        self._last_roi_input_size = (width, height)

    @staticmethod
    def _distance_to_bbox(points: np.ndarray, distances: np.ndarray) -> np.ndarray:
        return np.stack(
            (
                points[:, 0] - distances[:, 0],
                points[:, 1] - distances[:, 1],
                points[:, 0] + distances[:, 2],
                points[:, 1] + distances[:, 3],
            ),
            axis=-1,
        )

    @staticmethod
    def _distance_to_keypoints(points: np.ndarray, distances: np.ndarray) -> np.ndarray:
        values = []
        for index in range(0, distances.shape[1], 2):
            values.append(points[:, 0] + distances[:, index])
            values.append(points[:, 1] + distances[:, index + 1])
        return np.stack(values, axis=-1)

    def _anchor_centers(self, height: int, width: int, stride: int) -> np.ndarray:
        key = (height, width, stride, self.num_anchors)
        cached = self._center_cache.get(key)
        if cached is not None:
            return cached
        centers = np.stack(np.mgrid[:height, :width][::-1], axis=-1).astype(np.float32)
        centers = (centers * stride).reshape((-1, 2))
        if self.num_anchors > 1:
            centers = np.stack([centers] * self.num_anchors, axis=1).reshape((-1, 2))
        if len(self._center_cache) < 100:
            self._center_cache[key] = centers
        return centers

    def _forward(self, image: np.ndarray) -> tuple[list[np.ndarray], list[np.ndarray], list[np.ndarray]]:
        blob = cv2.dnn.blobFromImage(
            image,
            scalefactor=1.0 / 128.0,
            size=self.input_size,
            mean=(127.5, 127.5, 127.5),
            swapRB=True,
        )
        outputs = self.session.run(self.output_names, {self.input_name: blob})
        input_height, input_width = int(blob.shape[2]), int(blob.shape[3])
        scores_list: list[np.ndarray] = []
        boxes_list: list[np.ndarray] = []
        keypoints_list: list[np.ndarray] = []

        for index, stride in enumerate(self.feature_strides):
            scores = np.asarray(outputs[index])
            box_distances = np.asarray(outputs[index + self.feature_map_count])
            keypoint_distances = np.asarray(outputs[index + self.feature_map_count * 2])
            if scores.ndim == 3:
                scores = scores[0]
                box_distances = box_distances[0]
                keypoint_distances = keypoint_distances[0]
            scores = scores.reshape(-1)
            box_distances = box_distances.reshape(-1, 4) * stride
            keypoint_distances = keypoint_distances.reshape(-1, 10) * stride
            centers = self._anchor_centers(input_height // stride, input_width // stride, stride)
            if not (len(scores) == len(box_distances) == len(keypoint_distances) == len(centers)):
                raise RuntimeError(
                    f"SCRFD output/anchor shape mismatch at stride {stride}: "
                    f"scores={len(scores)}, boxes={len(box_distances)}, "
                    f"keypoints={len(keypoint_distances)}, anchors={len(centers)}"
                )
            selected = np.where(scores >= self.score_threshold)[0]
            if selected.size == 0:
                continue
            scores_list.append(scores[selected])
            boxes_list.append(self._distance_to_bbox(centers, box_distances)[selected])
            decoded_keypoints = self._distance_to_keypoints(centers, keypoint_distances)
            keypoints_list.append(decoded_keypoints[selected].reshape(-1, 5, 2))
        return scores_list, boxes_list, keypoints_list

    def _nms(self, detections: np.ndarray) -> list[int]:
        x1, y1, x2, y2, scores = (detections[:, index] for index in range(5))
        areas = (x2 - x1 + 1.0) * (y2 - y1 + 1.0)
        order = scores.argsort()[::-1]
        keep: list[int] = []
        while order.size:
            current = int(order[0])
            keep.append(current)
            xx1 = np.maximum(x1[current], x1[order[1:]])
            yy1 = np.maximum(y1[current], y1[order[1:]])
            xx2 = np.minimum(x2[current], x2[order[1:]])
            yy2 = np.minimum(y2[current], y2[order[1:]])
            width = np.maximum(0.0, xx2 - xx1 + 1.0)
            height = np.maximum(0.0, yy2 - yy1 + 1.0)
            overlap = width * height / (areas[current] + areas[order[1:]] - width * height)
            order = order[np.where(overlap <= self.nms_threshold)[0] + 1]
        return keep

    def detect(self, image: np.ndarray):
        """Return ``(None, faces)`` to match ``cv2.FaceDetectorYN.detect``."""

        if image is None or image.ndim != 3 or image.shape[2] != 3:
            raise ValueError("SCRFD input must be a BGR image with shape (H, W, 3).")
        source_height, source_width = image.shape[:2]
        target_width, target_height = self.input_size
        image_ratio = source_height / source_width
        target_ratio = target_height / target_width
        if image_ratio > target_ratio:
            resized_height = target_height
            resized_width = max(1, int(resized_height / image_ratio))
        else:
            resized_width = target_width
            resized_height = max(1, int(resized_width * image_ratio))
        scale = resized_height / source_height
        resized = cv2.resize(image, (resized_width, resized_height))
        canvas = np.zeros((target_height, target_width, 3), dtype=np.uint8)
        canvas[:resized_height, :resized_width] = resized

        scores_list, boxes_list, keypoints_list = self._forward(canvas)
        if not scores_list:
            return None, None
        scores = np.concatenate(scores_list).reshape(-1)
        boxes = np.vstack(boxes_list) / scale
        keypoints = np.vstack(keypoints_list) / scale
        order = scores.argsort()[::-1]
        boxes = boxes[order]
        scores = scores[order]
        keypoints = keypoints[order]
        pre_nms = np.column_stack((boxes, scores)).astype(np.float32, copy=False)
        keep = self._nms(pre_nms)
        boxes = boxes[keep]
        scores = scores[keep]
        keypoints = keypoints[keep]

        boxes[:, 0::2] = np.clip(boxes[:, 0::2], 0, source_width)
        boxes[:, 1::2] = np.clip(boxes[:, 1::2], 0, source_height)
        keypoints[:, :, 0] = np.clip(keypoints[:, :, 0], 0, source_width)
        keypoints[:, :, 1] = np.clip(keypoints[:, :, 1], 0, source_height)
        faces = np.zeros((len(boxes), 15), dtype=np.float32)
        faces[:, 0] = boxes[:, 0]
        faces[:, 1] = boxes[:, 1]
        faces[:, 2] = np.maximum(0.0, boxes[:, 2] - boxes[:, 0])
        faces[:, 3] = np.maximum(0.0, boxes[:, 3] - boxes[:, 1])
        faces[:, 4:14] = keypoints.reshape(-1, 10)
        faces[:, 14] = scores
        return None, faces if len(faces) else None

    def statistics(self) -> dict[str, object]:
        return {
            "backend": "scrfd",
            "model_path": str(self.model_path),
            "input_size": list(self.input_size),
            "score_threshold": self.score_threshold,
            "nms_threshold": self.nms_threshold,
            "requested_providers": list(self.requested_providers),
            "active_providers": list(self.active_providers),
            "require_cuda": self.require_cuda,
            "output_count": len(self.output_names),
            "uses_five_keypoints": self.use_keypoints,
        }
