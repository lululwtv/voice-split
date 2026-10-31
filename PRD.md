# Voice-split: speaker recognition and continuous improvement

**Status:** Draft for review  
**Date:** 31 October 2026  
**Scope:** Local meeting transcription, short-utterance speaker attribution, voice enrollment, corrections, and reference learning.

## 1. Product intent

Voice-split turns meeting audio into a transcript attributed to the people speaking. Participants enroll their voices once, preferably join from their own laptops with their own microphones, and correct attribution mistakes directly in the transcript.

The product must attempt attribution for every detected speech utterance, including short acknowledgments and fillers such as “yeah,” “okay,” and “I mean.” It must expose uncertainty without withholding the best available speaker assignment merely because the utterance is short or its similarity score is below a fixed cutoff.

The intended outcome is fast, useful attribution that becomes easier to correct and more reliable as approved voice references accumulate. Reliable recognition of an isolated short phrase is an experimental objective, not an established capability.

## 2. Problem and evidence

The current prototype can transcribe speech while displaying its speaker as Unknown. Investigation of the supplied test export found two different rejection paths:

- A 1.08-second phrase was not compared against saved voices because matching required at least two seconds of audio.
- Another phrase received a cosine similarity score of approximately 0.593, below the configured 0.70 cutoff.

The investigation also identified inconsistent audio preparation: enrollment embedded the whole recording, including padding, while live matching used speech spans. The local v0.1.1 changes select enrollment speech spans, construct references from shorter windows, expose rejection reasons, and provide safe re-recording.

Public-fixture tests showed improved robustness to padded recordings, but independent speech from the same speaker still failed the existing cutoff. These findings do not establish that recognition of the user's voice is fixed. Existing cosine similarity scores are not calibrated probabilities.

## 3. Goals and boundaries

### Goals

1. Attempt attribution for short speech without an arbitrary minimum matching duration.
2. Make initial enrollment take approximately 15–20 seconds of actual speech.
3. Combine personal microphone evidence with voice evidence using a measurable, adjustable approach.
4. Let users correct speaker assignments quickly and preserve their corrections.
5. Improve saved references using deliberate recordings and usable corrected clips.
6. Make weak attribution visible and keep audio retention understandable.

### Outside this release

- Google Meet integration, its audio-merging feature, and production echo cancellation across devices.
- Voice cloning, speech synthesis, or authentication using voice identity.
- Public hosting of personal audio or biometric references.
- Guarantees that all isolated one-word utterances can be identified accurately.
- Learning from unreviewed automatic speaker guesses.

The current application is a localhost prototype. Actual participation from separate laptops requires a networking and device-joining capability beyond opening the same localhost URL. That dependency must be resolved before claiming multi-laptop support.

## 4. Agreed product decisions

| Area | Decision |
| --- | --- |
| Initial enrollment | Collect 15–20 seconds of actual speech; silence does not count toward completion. |
| Prompts | Offer varied, phonetically rich sentences and a Shuffle control. Everyone need not read identical text. |
| Additional samples | Append usable new samples to the existing person's reference collection. |
| Short speech | Attempt matching for all detected speech, including fillers; remove the two-second matching gate. |
| Assignment | Choose the highest-ranked eligible meeting participant when usable evidence exists. |
| Participant set | Match against the meeting roster, with support for adding people during a meeting. |
| Microphones | Encourage a named personal laptop/microphone for each participant. |
| Evidence combination | Begin experimentation with 70% microphone evidence and 30% voice evidence. |
| Uncertainty | Display the selected name with a Low confidence indicator when evidence is weak. |
| Corrections | Allow a speaker correction directly from a transcript segment. |
| Learning | Automatically learn from corrected clips only when they are suitable single-speaker speech. |
| Revisions | Automatic assignments may improve with later evidence; manual assignments remain fixed. |
| Retention | Finish review deletes unapproved meeting audio; otherwise delete it after seven days. |
| Saved references | Approved reference samples remain until the user removes them. |

## 5. User journeys

### 5.1 Enroll a voice

1. Enter a name or select an existing person.
2. Read the displayed prompt naturally, or select Shuffle for a different prompt.
3. Record while a speech-duration indicator progresses toward 15–20 seconds.
4. If the prompt ends early, continue with another sentence until enough usable speech is collected.
5. Review the recording and save it. Failed validation explains what to retry.
6. For an existing person, distinguish adding a sample from explicitly replacing a reference. A failed operation preserves the existing reference.

Prompt variety is intended to make repeated enrollment less tedious and provide varied speech. The prompt collection's phonetic coverage and the adequacy of the enrollment duration must be evaluated rather than assumed.

### 5.2 Start a meeting

1. Create or join a meeting and select its participants from enrolled voices.
2. Associate each personal microphone connection with its participant.
3. Allow a shared or unassigned microphone when ownership cannot be established.
4. Start listening; display the selected participant on each transcribed speech segment.
5. Allow a participant to be added without restarting the meeting.

### 5.3 Correct and improve

1. Select an incorrect name on a transcript segment.
2. Choose the correct participant.
3. Immediately update the transcript and mark the assignment as manually corrected.
4. Evaluate the associated audio for reference learning.
5. If usable, add it to that participant's reference collection; otherwise retain the transcript correction and explain that the audio was unsuitable for learning.
6. Preserve the corrected label when later automatic analysis arrives and in subsequent exports.

### 5.4 Finish review

1. Review uncertain assignments and make any desired corrections.
2. Select Finish review.
3. Delete unapproved meeting audio while retaining the transcript and approved references.
4. Explain that deleted audio will no longer be available for replay or later reference learning.

## 6. Functional requirements

### FR-1: Enrollment and sample management

- Measure actual detected speech rather than elapsed recording time.
- Target 15–20 seconds of usable initial speech, excluding silence and unusable portions.
- Provide Shuffle without changing the target speech duration or discarding an already saved reference.
- Offer natural, varied prompts. Live GPT generation is not required by this PRD; a curated prompt collection is acceptable.
- Preserve multiple approved samples rather than repeatedly overwriting a person's identity representation.
- Keep sample provenance sufficient to distinguish enrollment recordings from learned meeting clips and support sample removal.
- Support adding, replacing, and removing references with clear effects on future matching.

### FR-2: Short-utterance attribution

- Remove the existing two-second eligibility rule for meeting speaker matching.
- Attempt recognition for “yeah,” “I mean,” and other short detected speech without requiring a particular word or phrase.
- Choose the highest-ranked participant even when the score is below the previous acceptance threshold.
- Do not invent a voice score if the embedding model cannot process the clip. Record that limitation and use other available evidence according to the ranking policy.
- Empty audio, silence, model failures, and an empty roster require explicit handling. They are not successful speaker matches.
- Allow abstention when no eligible participant or usable evidence exists. This exception must not recreate a fixed minimum-duration gate.

### FR-3: Microphone and voice evidence

- Associate microphone ownership through an explicit participant/device relationship, not by treating loudness as identity.
- Use microphone evidence as a stronger initial signal for personal devices, while retaining voice comparison.
- Test the initial combination `combined_score = 0.7 × microphone_evidence + 0.3 × voice_evidence` only after the two inputs are placed on a comparable, evaluated scale.
- Treat those weights as an initial hypothesis, not a validated confidence formula.
- Shared or unassigned microphones must not be credited to an arbitrary owner.
- Define a missing-evidence policy before implementation. Proposed default: use the available evidence and expose reduced certainty rather than inserting a fabricated zero or probability.
- Evaluate microphone leakage, shared rooms, device changes, and cases where the loudest microphone belongs to someone other than the speaker.

### FR-4: Confidence presentation

- Display the selected speaker as the primary result.
- Show Low confidence for weak evidence, close candidates, or conflicting source and voice evidence, using rules established during evaluation.
- Provide a direct correction action on the segment.
- Do not present cosine similarity or an uncalibrated weighted score as a percentage probability.
- Keep diagnostic information available for development and testing, including candidate scores, evidence sources, and automatic versus manual assignment.

### FR-5: Revisions and correction integrity

- Allow automatic labels to be revised as additional relevant evidence arrives.
- Give manual corrections precedence over later automatic results.
- Persist corrections so reconnecting, reloading, or exporting does not restore the old label.
- Correcting a transcript must succeed independently of whether reference learning succeeds.
- A change to a previous correction must not leave its learned sample assigned to the wrong person. Reference contributions need an undo/reassignment path.

### FR-6: Reference learning

- Accept deliberate new recordings and qualifying, explicitly corrected meeting clips as reference sources.
- Automatically evaluate corrected clips for overlap, speech quality, and suitability for the embedding model before admission.
- A short clip may receive a transcript label without being suitable as a training reference. Matching eligibility and reference quality are separate decisions.
- Do not learn from an automatic assignment merely because it has the highest score.
- Make the outcome visible: reference improved, or transcript corrected but audio not used.
- More samples must not be assumed to guarantee better recognition; evaluation must detect degradation as samples accumulate.

### FR-7: Audio retention

- Retain meeting audio locally for replay, correction review, and approved reference extraction.
- Explain before recording which audio is retained and that approved reference samples outlive meeting audio.
- Finish review deletes all unapproved audio for that meeting.
- If review is not finished, automatically delete unapproved audio after seven days.
- Proposed clock definition: seven days from meeting end; for an abandoned meeting, use its last captured audio time.
- If the application is closed when deletion becomes due, enforce expiry on the next start before permitting replay or learning from expired audio.
- Keep approved references until removed by the user. Keep transcript text separately from the audio retention lifecycle.
- Once audio is deleted, text and speaker labels may still be edited, but reference learning from that audio is unavailable.

## 7. Evaluation and success measures

### Evaluation set

Use recordings from multiple consenting speakers. Keep evaluation utterances separate from enrollment and learned reference clips. Include:

- Very short acknowledgments, fillers, ordinary sentences, and longer turns.
- Different wording between enrollment and evaluation.
- Personal microphones, shared microphones, and another person's microphone capturing the loudest signal.
- Quiet speech, background noise, different recording sessions, and device changes.
- Similar-sounding participants, interruptions, and overlapping speech.
- Speakers who are absent from the selected roster, to expose the cost of forced assignment.

### Measures

| Measure | Purpose |
| --- | --- |
| Attribution accuracy by utterance duration | Determine whether short-phrase support actually works. |
| Accuracy by microphone condition | Test whether source weighting helps or harms. |
| Correction rate per meeting | Measure practical user effort. |
| Accuracy before and after reference additions | Detect improvement or reference contamination. |
| Error rate among Low confidence versus unflagged labels | Test whether uncertainty indicators are useful. |
| Time to first label and time to stable label | Evaluate speed and revision behavior. |
| Enrollment completion time and retry rate | Evaluate the setup burden. |
| Manual-label overwrite count | Must remain zero. |
| Audio retention and deletion checks | Verify lifecycle behavior, including application restarts. |

Compare voice-only, microphone-only, and the proposed 70/30 combination on the same evaluation set. Calibrate confidence using separate calibration data and evaluate it on held-out recordings. Numeric accuracy and latency release targets remain to be set after measuring a baseline; this PRD does not claim a validated target.

## 8. Acceptance criteria

- A detected short utterance is offered to matching without the old two-second gate.
- With eligible participants and usable evidence, a low score still yields the highest-ranked participant and an appropriate uncertainty indicator.
- Silence does not count toward the 15–20-second enrollment target.
- Shuffle changes the suggested text; saving additional audio preserves prior approved samples.
- Ranking excludes enrolled people who are not on the meeting roster.
- Shared microphone input does not inherit an arbitrary participant's identity.
- Correcting a segment updates its displayed and exported speaker and survives reloads and later automatic analysis.
- A usable corrected clip contributes to the selected person's references; an unusable clip changes only the transcript.
- Revising or undoing a correction does not leave an incorrectly labeled reference contribution active.
- Finish review and expiry remove unapproved audio while preserving approved references and transcript text.
- The application reports evidence/model failures accurately instead of manufacturing a confidence score.

These are functional acceptance criteria. A passing implementation does not by itself establish reliable short-phrase recognition; the evaluation results must be reported separately.

## 9. Dependencies and unresolved experiments

1. **Multiple laptops:** Select a local-network joining and audio-transport approach, including participant/device association, before implementing microphone weighting across real devices. The current strongest-microphone window selection is not sufficient evidence of production multi-device support.
2. **Timing and overlap:** Establish how audio across devices is aligned and how simultaneous speakers are handled. Do not assume a mixed segment represents one person.
3. **Short-clip model behavior:** Determine which short clips the embedding model can process and whether another model or temporal evidence improves results.
4. **Evidence scaling and weights:** Define microphone evidence, normalize it compatibly with voice evidence, and compare the 70/30 hypothesis with measured alternatives.
5. **Reference admission:** Establish quality checks for corrected audio and test whether accumulating references improves held-out accuracy.
6. **Confidence and speed:** Set uncertainty rules, revision timing, and measurable release targets from the evaluation baseline.

## 10. Delivery scope

Implement and validate the local attribution, enrollment, correction, reference, and retention behavior first. Treat real multi-laptop microphone evidence as a dependent capability with its own end-to-end verification. Future Google Meet integration can build on these interfaces once their behavior and accuracy are established.

All code and document changes remain local and uncommitted unless the user separately authorizes a Git or deployment action.

## 11. Clarification: short speech is independent of wording

“Yeah” is an illustrative example, not a special recognition target. The requirement covers any short speech utterance, regardless of its words: acknowledgments, questions, names, fragments, and other brief contributions.

- Do not add a phrase whitelist, keyword-specific matcher, or mandatory filler-word enrollment script.
- Attempt attribution whenever detected speech and usable evidence exist, without a product-level minimum matching duration.
- Evaluate by actual speech duration, speaker, recording condition, and wording, including phrases absent from enrollment and calibration data.
- Distinguish attempting attribution from achieving correct attribution. Show uncertainty and retain correction controls when evidence is weak.

## 12. Future extension: optional spoken meeting assistant

PersonaPlex is a candidate for a later conversational assistant extension. Its documented role is simultaneous speech understanding and generation with role and voice conditioning; it is not an established replacement for the product's speaker attribution pipeline. See the [NVIDIA repository](https://github.com/NVIDIA/personaplex) and [model card](https://huggingface.co/nvidia/personaplex-7b-v1).

Potential user experiences include asking about decisions or action owners, requesting a spoken recap, and correcting a speaker by saying, for example, “That last comment was Sarah.” These are proposed integrations requiring application logic and meeting-context access; they are not built-in voice-split features or validated capabilities of the model in our setting.

The extension should:

- Be optional and leave core transcription and attribution available when disabled or unavailable.
- Use a distinct assistant identity; assistant-generated speech must never become a participant's reference sample.
- Resolve spoken corrections to a specific segment and participant, then obtain confirmation before applying the correction and any resulting reference update.
- Answer using available meeting evidence, identifying uncertainty when the transcript does not support an answer.
- Evaluate deployment hardware, latency, operating cost, model terms, and any transfer of meeting audio before enabling it.

This extension remains outside the core release described above. The technical proposal and implementation dependencies are captured in [TRD.md](TRD.md).
