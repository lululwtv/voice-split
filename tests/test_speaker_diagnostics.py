import importlib
import io
import sys
import time
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from voice_split.profiles import ProfileStore
from voice_split.streaming import recognize_window
from voice_split.identification import enrollment_reference, speech_samples


def test_speech_selection_merges_overlaps_and_clips_invalid_spans():
    samples=np.arange(80000,dtype=np.float32)
    rows=[{'start':2.,'end':4.}, {'start':1.,'end':3.},
          {'start':float('nan'),'end':5.}, {'start':4.5,'end':8.}]
    np.testing.assert_array_equal(speech_samples(samples,rows),
        np.concatenate([samples[16000:64000],samples[72000:]]))


def test_reference_uses_short_windows_and_normalizes_centroid():
    samples=(.1*np.sin(np.arange(16000*8)*.1)).astype(np.float32)
    lengths=[]
    def embed(audio):
        lengths.append(len(audio))
        return np.array([1.,0.]) if len(lengths)==1 else np.array([0.,1.])
    engines=SimpleNamespace(transcribe=lambda audio:[{'start':0.,'end':8.}],embed=embed)
    reference=enrollment_reference(engines,samples)
    assert lengths==[48000,48000,32000]
    np.testing.assert_allclose(reference,np.array([1.,2.])/np.sqrt(5))


def test_short_phrase_reports_insufficient_speech_instead_of_silent_unknown(tmp_path):
    profiles=ProfileStore(tmp_path)
    profiles.enroll('Edric',np.array([1.,0.]))
    engines=SimpleNamespace(transcribe=lambda audio:[{'start':.5,'end':1.58,'text':'Hello',
        'words':[{'start':.5,'end':1.58,'word':'Hello'}]}],embed=lambda audio:pytest.fail('Short phrase must not be matched'))
    state=SimpleNamespace(context=np.empty(0,dtype=np.float32),emitted_until=0)
    rows=recognize_window(engines,profiles,state,np.ones(48000,dtype=np.float32),0)
    assert rows[0]['speaker']=='Unknown'
    assert rows[0]['identification']['reason']=='insufficient_speech'
    assert rows[0]['identification']['speech_seconds']==pytest.approx(1.08)


def test_export_score_is_explained_without_relaxing_rejection(tmp_path, monkeypatch):
    monkeypatch.setenv('VOICE_SPLIT_MATCH_THRESHOLD', '.70')
    profiles=ProfileStore(tmp_path)
    profiles.enroll('Edric',np.array([1.,0.]))
    score=.5928929146811268
    result=profiles.assess(np.array([score,np.sqrt(1-score**2)]))
    assert result['speaker']=='Unknown'
    assert result['identification']['reason']=='below_threshold'
    assert result['identification']['candidate']=='Edric'
    assert result['identification']['threshold']==.7
    assert result['score']==pytest.approx(score)


def test_enrollment_embeds_speech_not_recording_padding(tmp_path,monkeypatch):
    monkeypatch.setenv('VOICE_SPLIT_DATA_DIR',str(tmp_path))
    sys.modules.pop('voice_split.server',None)
    server=importlib.import_module('voice_split.server')
    monkeypatch.setattr(server.engines,'load',lambda:None)
    monkeypatch.setattr(server.engines,'status',lambda:{'ready':True})
    monkeypatch.setattr(server.engines,'transcribe',lambda audio:[{'start':2.,'end':5.,'text':'This is the speech.'}])
    lengths=[]
    def embed(audio):
        lengths.append(len(audio))
        return np.array([1.,0.])
    monkeypatch.setattr(server.engines,'embed',embed)
    samples=np.zeros(16000*8,dtype=np.float32)
    samples[32000:80000]=.1*np.sin(np.arange(48000)*.1)
    recording=io.BytesIO();sf.write(recording,samples,16000,format='WAV')
    with TestClient(server.app,base_url='http://localhost') as client:
        for _ in range(100):
            if not client.get('/api/status').json()['loading']:break
            time.sleep(.01)
        result=client.post('/api/profiles',data={'name':'Edric'},files={'file':('sample.wav',recording.getvalue())})
        assert result.status_code==200,result.text
    assert lengths==[48000], 'Non-speech recording padding must not be part of the saved speaker reference'
