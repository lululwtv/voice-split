from types import SimpleNamespace

import numpy as np

from voice_split.streaming import recognize_window


class Profiles:
    threshold = .7
    margin = .08
    def list(self):
        return []


def model(words):
    return SimpleNamespace(transcribe=lambda samples: [{"start": 0, "end": len(samples)/16000,
        "words": [{"start": a, "end": b, "word": text} for a,b,text in words]}])


def test_boundary_holdback_is_emitted_on_flush_without_duplicate_words():
    state=SimpleNamespace(context=np.empty(0,dtype=np.float32),emitted_until=0.)
    samples=np.ones(48000,dtype=np.float32)*.1
    first=recognize_window(model([(0,1,'Hello'),(2.8,3,' world')]),Profiles(),state,samples,0)
    assert first[0]['text']=='Hello'
    final=recognize_window(model([(1.8,2,' world')]),Profiles(),state,np.empty(0,dtype=np.float32),3,True)
    assert final[0]['text']=='world'
    assert final[0]['end']==3
    repeated=recognize_window(model([(1.8,2,' world')]),Profiles(),state,np.empty(0,dtype=np.float32),3,True)
    assert repeated==[]


def test_new_window_uses_prior_context_and_absolute_word_offsets():
    state=SimpleNamespace(context=np.ones(32000,dtype=np.float32),emitted_until=3.)
    result=recognize_window(model([(1,1.5,' old'),(2,2.5,' new')]),Profiles(),state,np.ones(48000,dtype=np.float32),3)
    assert result[0]['text']=='new'
    assert result[0]['start']==3
    assert result[0]['end']==3.5
    assert len(state.context)==32000


def test_redecoded_overlapping_word_is_removed_but_real_repetition_is_kept():
    state=SimpleNamespace(context=np.ones(32000,dtype=np.float32),emitted_until=3.,last_word='ask')
    result=recognize_window(model([(1.9,2.2,' ask'),(2.3,2.6,' ask'),(2.6,3,' what')]),Profiles(),state,np.ones(48000,dtype=np.float32),3)
    assert result[0]['text']=='ask what'
