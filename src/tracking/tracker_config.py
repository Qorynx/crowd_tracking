"""Validation and capability checks for the tracker profiles used by this app."""

from __future__ import annotations

from dataclasses import dataclass, replace
from importlib.util import find_spec
from pathlib import Path
from typing import Any, Mapping


# The public application ships one tracker profile. Keeping this allow-list
# narrow prevents an environment override from silently selecting an
# unsupported tracker at runtime.
SUPPORTED_TRACKER_TYPES = frozenset({"bytetrack", "deepocsort", "fasttrack"})
# Ultralytics binds this value into tracking callbacks on the first model.track() call.
# It must therefore be true from frame one, not toggled after the stream starts.
PERSIST_TRACKER_ACROSS_FRAMES = True


@dataclass(frozen=True)
class TrackerProfile:
    """A parsed tracker YAML file that is safe for this application's pipeline."""

    path: Path
    tracker_type: str
    values: dict[str, Any]
    runtime_path: Path | None = None


def _require_probability(config: Mapping[str, Any], key: str, source: str) -> None:
    value = config.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0.0 <= float(value) <= 1.0:
        raise ValueError(f"{source}: '{key}' must be a number between 0 and 1.")


def validate_tracker_config(config: Mapping[str, Any], source: str = "tracker config") -> str:
    """Validate the supported tracker subset and return its normalized tracker type."""
    raw_tracker_type = config.get("tracker_type")
    if not isinstance(raw_tracker_type, str):
        raise ValueError(f"{source}: missing string field 'tracker_type'.")
    tracker_type = raw_tracker_type.lower()
    if tracker_type not in SUPPORTED_TRACKER_TYPES:
        supported = ", ".join(sorted(SUPPORTED_TRACKER_TYPES))
        raise ValueError(f"{source}: unsupported tracker_type '{raw_tracker_type}'. Supported values: {supported}.")

    for key in ("track_high_thresh", "track_low_thresh", "new_track_thresh", "match_thresh"):
        _require_probability(config, key, source)
    if float(config["track_low_thresh"]) > float(config["track_high_thresh"]):
        raise ValueError(f"{source}: 'track_low_thresh' must not exceed 'track_high_thresh'.")

    track_buffer = config.get("track_buffer")
    if isinstance(track_buffer, bool) or not isinstance(track_buffer, int) or track_buffer < 1:
        raise ValueError(f"{source}: 'track_buffer' must be a positive integer number of processed frames.")
    if not isinstance(config.get("fuse_score"), bool):
        raise ValueError(f"{source}: 'fuse_score' must be boolean.")

    if tracker_type == "fasttrack":
        for key in ("occ_cover_thresh", "dampen_motion_occ", "init_iou_suppress"):
            _require_probability(config, key, source)
        enlarge_bbox = config.get("enlarge_bbox_occ")
        if isinstance(enlarge_bbox, bool) or not isinstance(enlarge_bbox, (int, float)) or float(enlarge_bbox) < 1.0:
            raise ValueError(f"{source}: 'enlarge_bbox_occ' must be a number greater than or equal to 1.")
        for key in (
            "reset_velocity_offset_occ",
            "reset_pos_offset_occ",
            "active_occ_to_lost_thresh",
            "occ_reappear_window",
        ):
            value = config.get(key)
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ValueError(f"{source}: '{key}' must be a positive integer.")
    elif tracker_type == "deepocsort":
        with_reid = config.get("with_reid")
        if not isinstance(with_reid, bool):
            raise ValueError(f"{source}: 'with_reid' must be boolean.")
        model = config.get("model")
        if not isinstance(model, str) or not model.strip():
            raise ValueError(f"{source}: 'model' must be a non-empty string.")
        for key in ("proximity_thresh", "appearance_thresh", "alpha_fixed_emb", "inertia"):
            _require_probability(config, key, source)
        delta_t = config.get("delta_t")
        if isinstance(delta_t, bool) or not isinstance(delta_t, int) or delta_t < 1:
            raise ValueError(f"{source}: 'delta_t' must be a positive integer.")
        if not isinstance(config.get("use_byte"), bool):
            raise ValueError(f"{source}: 'use_byte' must be boolean.")

    return tracker_type


def load_tracker_profile(path: Path) -> TrackerProfile:
    """Load and validate a local tracker configuration file supported by this app."""
    try:
        import yaml
    except ImportError as error:
        raise RuntimeError("PyYAML is required to load tracker profiles. Install requirements.txt.") from error
    if not path.is_file():
        raise FileNotFoundError(f"Tracker config not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        values = yaml.safe_load(handle) or {}
    if not isinstance(values, dict):
        raise ValueError(f"Tracker config must contain a YAML mapping: {path}")
    tracker_type = validate_tracker_config(values, str(path))
    return TrackerProfile(path=path, tracker_type=tracker_type, values=values)


def ensure_tracker_backend_available(tracker_type: str) -> None:
    """Fail early when installed Ultralytics lacks the production FastTracker backend."""

    if tracker_type not in SUPPORTED_TRACKER_TYPES:
        raise ValueError(f"Unsupported tracker profile; received {tracker_type!r}.")
    if tracker_type in {"bytetrack", "deepocsort"}:
        try:
            import ultralytics  # noqa: F401
        except ImportError as error:
            raise RuntimeError("The selected tracker requires the installed Ultralytics runtime.") from error
        return
    module_name, class_name, display_name = (
        "ultralytics.trackers.fast_tracker",
        "FASTTracker",
        "FastTracker",
    )
    try:
        module = __import__(module_name, fromlist=[class_name])
        getattr(module, class_name)
        from ultralytics.trackers.track import TRACKER_MAP
    except (ImportError, ModuleNotFoundError, AttributeError) as error:
        raise RuntimeError(
            f"{display_name} requires an Ultralytics release that includes '{module_name}'. "
            "Install the pinned runtime requirements before selecting this tracker profile."
        ) from error
    if tracker_type not in TRACKER_MAP:
        raise RuntimeError(
            f"The installed Ultralytics package exposes {display_name} but has not registered "
            f"the '{tracker_type}' tracker backend. Reinstall the pinned runtime requirements."
        )


def ensure_tracker_reid_runtime_available(profile: TrackerProfile) -> None:
    """Fail before tracking when a dedicated Deep OC-SORT ReID runtime is absent."""

    if profile.tracker_type != "deepocsort" or not bool(profile.values.get("with_reid", False)):
        return
    model = str(profile.values.get("model", "auto")).strip().lower()
    if model in {"", "auto"}:
        return
    if find_spec("onnxruntime") is None:
        raise RuntimeError(
            "Dedicated Deep OC-SORT ReID requires onnxruntime. "
            "Install deploy/requirements-reid.txt before selecting this tracker profile."
        )


def resolve_tracker_runtime_paths(profile: TrackerProfile, project_root: Path) -> TrackerProfile:
    """Resolve a dedicated ReID model path without mutating the source YAML."""

    if profile.tracker_type != "deepocsort" or not bool(profile.values.get("with_reid", False)):
        return profile
    model = str(profile.values.get("model", "auto")).strip()
    if model.lower() == "auto":
        return profile
    resolved_model = Path(model)
    if not resolved_model.is_absolute():
        resolved_model = project_root / resolved_model
    resolved_model = resolved_model.resolve()
    if not resolved_model.is_file():
        raise FileNotFoundError(
            f"Dedicated ReID model not found: {resolved_model}. "
            "Provision it with `python scripts/download_reid_model.py` before starting the tracker."
        )
    values = dict(profile.values)
    values["model"] = str(resolved_model)
    return replace(profile, values=values)


def materialize_tracker_runtime_config(profile: TrackerProfile, output_directory: Path) -> TrackerProfile:
    """Write a private tracker YAML when resolved paths must be passed to Ultralytics."""

    if profile.tracker_type != "deepocsort" or not bool(profile.values.get("with_reid", False)):
        return profile
    model = str(profile.values.get("model", "auto")).strip().lower()
    if model in {"", "auto"}:
        return profile
    try:
        import yaml
    except ImportError as error:
        raise RuntimeError("PyYAML is required to materialize a tracker runtime config.") from error
    output_directory.mkdir(parents=True, exist_ok=True)
    runtime_path = output_directory / profile.path.name
    runtime_path.write_text(yaml.safe_dump(profile.values, sort_keys=False), encoding="utf-8")
    return replace(profile, runtime_path=runtime_path)


def reset_attached_trackers(model: object) -> int:
    """Reset the tracker instances that Ultralytics attaches to an initialized predictor.

    `model.track(..., persist=True)` must be used for every webcam frame. Resetting the
    attached tracker here starts a new stream without registering non-persistent callbacks.
    """
    predictor = getattr(model, "predictor", None)
    trackers = getattr(predictor, "trackers", ()) if predictor is not None else ()
    reset_count = 0
    for tracker in trackers or ():
        reset = getattr(tracker, "reset", None)
        if callable(reset):
            reset()
            reset_count += 1
    return reset_count
