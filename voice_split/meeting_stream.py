"""Stream-local acoustic continuity, separate from persistent voice recognition."""
import uuid

import numpy as np

from .audio import SAMPLE_RATE
from .identification import MIN_SPEECH_SECONDS
from .profiles import _unit
from .open_matching import STRONG_MATCH

# Forward evidence starts where a probe's words start, so it can challenge the
# current speaker at the change instead of after a centered window has passed it.
FORWARD_SECONDS = 1.5
MIN_PROBE_SECONDS = 1.
CHANGE_SIMILARITY = .5
CONFIRM_SIMILARITY = .6
# Half a second of the same voice usually scores above this against a track's own speech.
SHORT_SIMILARITY = .4
# A returning voice must clearly match one earlier track in this stream to reuse its identity.
RECALL_SIMILARITY = .6
RECALL_MARGIN = .15
TRACK_SECONDS = 6
MAX_VOICES = 16


class MeetingStream:
    """Accumulate novel speech; short probes can challenge, never mint identities."""

    def __init__(self, matcher, room_id):
        self.matcher, self.room_id = matcher, room_id
        self.until = None
        self.resolutions = {}
        self.source_start = None
        self.voices, self.identity, self.anchored = [], None, 0
        self._start_track()

    def _start_track(self, track_id=None, audio=None, forward=None):
        if self.identity and self.anchored:
            self.voices = [*self.voices, (self.anchor, self.identity)][-MAX_VOICES:]
        self.track_id = track_id or uuid.uuid4().hex
        self.audio = np.empty(0, dtype=np.float32) if audio is None else audio[-TRACK_SECONDS * SAMPLE_RATE:]
        # Until the track has its own speech, its anchor is the mean of its forward probes.
        self.forward = forward
        self.anchor, self.anchored = None if forward is None else _unit(forward), 0
        self.identity = self.challenger = self.named_challenger = None
        self.aliases = set()

    def _resolve(self, identity):
        self.identity = identity
        for track in (self.track_id, *self.aliases):
            self.resolutions[track] = identity

    def _belongs_here(self, audio, rival=None):
        """Compare a challenger's own words with this track and the rival voice; None if too short."""
        own = self._embed(audio) if len(audio) >= .25 * SAMPLE_RATE and self.anchor is not None else None
        if own is None:
            return None
        return float(np.dot(own, self.anchor)) >= (SHORT_SIMILARITY if rival is None else float(np.dot(own, rival)))

    def _settle(self, rival=None):
        """Resolve an unconfirmed challenger. Without a rival, the challenger's own forward
        probe already contains this speaker again, so only a clear match joins the track."""
        if self.challenger and self._belongs_here(self.challenger[1], rival):
            self._absorb(self.challenger[2], self.challenger[1])
        self.challenger = None

    def _recall(self, participants):
        """Reuse the identity of an earlier track in this stream; never mints one."""
        own = self._embed(self.audio)
        best = {}
        for anchor, identity in self.voices if own is not None else ():
            if identity.get("profile_id") not in (None, *participants):
                continue
            key, score = identity.get("profile_id") or identity["unknown_id"], float(np.dot(own, anchor))
            if score > best.get(key, (-1.,))[0]:
                best[key] = (score, identity)
        ranked = sorted(best.values(), key=lambda item: -item[0])
        if not ranked or ranked[0][0] < RECALL_SIMILARITY or (
                len(ranked) > 1 and ranked[0][0] - ranked[1][0] < RECALL_MARGIN):
            return {}
        score, identity = ranked[0]
        return {**identity, "identification": {**identity["identification"], "reason": "stream_recall",
                                               "confidence": "low", "recall_similarity": round(score, 4)}}

    def _absorb(self, track, audio):
        """A challenger that proved to be this speaker resolves with this track."""
        self.audio = np.concatenate([self.audio, audio])[-TRACK_SECONDS * SAMPLE_RATE:]
        if self.identity:
            self.resolutions[track] = self.identity
        else:
            self.aliases.add(track)

    def _pending(self, reason, seconds=0, track_id=None):
        return dict(speaker="Unknown speaker", profile_id=None, unknown_id=None, score=None,
                    assignment_source="unassigned", track_id=track_id,
                    identification=dict(reason=reason, confidence="unavailable", calibrated=False,
                                        speech_seconds=round(seconds, 3), required_seconds=MIN_SPEECH_SECONDS))

    def _embed(self, samples):
        try:
            return _unit(self.matcher.engines.embed(samples))
        except (ValueError, RuntimeError):
            return None

    def observe(self, probe, speech, start, end, participants):
        if not len(speech):
            return self._pending("no_new_speech")
        if self.until is not None and start - self.until > 1.5:
            self._start_track()
        self.until = end
        if self.identity and self.identity.get("profile_id") not in (None, *participants):
            self._start_track()
        named = self.matcher.assess(self.room_id, speech, participants) if participants else None
        if named and named.get("profile_id") and (named.get("score") or 0) >= STRONG_MATCH:
            if self.identity and named["profile_id"] != self.identity.get("profile_id"):
                if not self.named_challenger or self.named_challenger[0] != named["profile_id"]:
                    track = uuid.uuid4().hex
                    self.named_challenger = (named["profile_id"], speech.copy(), track)
                    return self._pending("speaker_change_pending", len(speech) / SAMPLE_RATE, track)
                _, previous, track = self.named_challenger
                self._start_track(track, previous)
            elif self.identity is None and len(self.audio):
                earlier = self.matcher.assess(self.room_id, self.audio, participants)
                if earlier.get("profile_id") != named["profile_id"]:
                    self._start_track()
            self._resolve(named)
            self.named_challenger = None
            self._settle()
            self.audio = np.concatenate([self.audio, speech])[-TRACK_SECONDS * SAMPLE_RATE:]
            # Direct evidence for these words keeps its own score and confidence.
            return {**named, "track_id": self.track_id}
        self.named_challenger = None
        # Too little forward audio is weak evidence: it continues the track, never challenges it.
        vector = self._embed(probe) if len(probe) >= MIN_PROBE_SECONDS * SAMPLE_RATE else None
        similarity = float(np.dot(vector, self.anchor)) if vector is not None and self.anchor is not None else None
        # Forward evidence may already contain the next speaker. Keep collecting
        # this track when the current words still fit it better than that rival.
        if (similarity is not None and similarity < CHANGE_SIMILARITY
                and not self._belongs_here(speech, vector)):
            # A single distant observation is uncertainty, not a new identity.
            if self.challenger is None or float(np.dot(vector, self.challenger[0])) < CONFIRM_SIMILARITY:
                self._settle(vector)
                track = uuid.uuid4().hex
                self.challenger = (vector, speech.copy(), track)
                return self._pending("speaker_change_pending", len(speech) / SAMPLE_RATE, track)
            previous, audio, track = self.challenger
            # A forward probe can reach past this speaker's last words into the next voice;
            # words too short to compare stay unassigned rather than join either speaker.
            belongs = self._belongs_here(audio, vector)
            if belongs:
                self._absorb(track, audio)
            if belongs is False:
                self._start_track(track, np.concatenate([audio, speech]), previous + vector)
            else:
                self._start_track(None, speech, previous + vector)
        else:
            self._settle()
            self.audio = np.concatenate([self.audio, speech])[-TRACK_SECONDS * SAMPLE_RATE:]
            if vector is not None and not self.anchored:
                self.forward = vector if self.forward is None else self.forward + vector
                self.anchor = _unit(self.forward)
        # Once the track has enough of its own speech, compare against that instead of forward probes.
        if len(self.audio) >= MIN_SPEECH_SECONDS * SAMPLE_RATE and len(self.audio) - self.anchored >= SAMPLE_RATE:
            own = self._embed(self.audio)
            if own is not None:
                self.anchor, self.anchored = own, len(self.audio)
        seconds = len(self.audio) / SAMPLE_RATE
        if self.identity is None:
            match = self._recall(participants) if self.voices and seconds >= 1 else {}
            if not match and seconds >= MIN_SPEECH_SECONDS:
                match = self.matcher.identify_stream(self.room_id, self.audio, participants)
            elif not match:
                match = self.matcher.assess(self.room_id, probe, participants)
                if not match.get("profile_id") or (match.get("score") or 0) < STRONG_MATCH:
                    match = {}
            if match.get("profile_id") or match.get("unknown_id"):
                self._resolve(match)
        if self.identity is None:
            return self._pending("accumulating_speech", seconds, self.track_id)
        return {**self.identity, "track_id": self.track_id, "score": None,
                "identification": {**self.identity["identification"],
                                   "reason": "speaker_continuity", "confidence": "low",
                                   "continuity_similarity": None if similarity is None else round(similarity, 4),
                                   "continuity": "acoustic", "evidence_seconds": round(seconds, 3)}}

    def take_resolutions(self):
        result, self.resolutions = self.resolutions, {}
        return result
