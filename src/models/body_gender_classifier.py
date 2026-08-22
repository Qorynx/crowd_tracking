"""Body visual-presentation classifier kept separate from the face classifier."""

from __future__ import annotations

import torch
import torch.nn as nn
import torchvision.models as models

from src.models.gender_classifier import GENDER_LABELS


BODY_MODEL_ROLE = "body_visual_presentation"
BODY_MODEL_ARCHITECTURE = "convnext_tiny"
BODY_MODEL_ARCHITECTURES = frozenset({"mobilenet_v3_small", "convnext_tiny"})


class BodyGenderClassifier(nn.Module):
    """Body classifier with a checkpoint-selected torchvision backbone."""

    def __init__(
        self,
        architecture: str = BODY_MODEL_ARCHITECTURE,
        pretrained: bool = False,
    ) -> None:
        super().__init__()
        if architecture == "mobilenet_v3_small":
            weights = models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
            backbone = models.mobilenet_v3_small(weights=weights)
            self._flatten_before_classifier = True
        elif architecture == "convnext_tiny":
            weights = models.ConvNeXt_Tiny_Weights.IMAGENET1K_V1 if pretrained else None
            backbone = models.convnext_tiny(weights=weights)
            self._flatten_before_classifier = False
        else:
            supported = ", ".join(sorted(BODY_MODEL_ARCHITECTURES))
            raise ValueError(
                f"Unsupported body model architecture {architecture!r}; expected one of: {supported}."
            )
        in_features = backbone.classifier[-1].in_features
        backbone.classifier[-1] = nn.Linear(in_features, len(GENDER_LABELS))
        # Preserve torchvision's native key layout (features.*, avgpool.*, classifier.*)
        # because the trained checkpoint was saved directly from that layout.
        self.features = backbone.features
        self.avgpool = backbone.avgpool
        self.classifier = backbone.classifier
        self.architecture = architecture

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        features = self.features(images)
        pooled = self.avgpool(features)
        if self._flatten_before_classifier:
            pooled = torch.flatten(pooled, 1)
        return self.classifier(pooled)
