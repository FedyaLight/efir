use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use libloading::Library;
use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Duration,
};

pub type SpeechEvent = Arc<dyn Fn(&str, Option<&str>, bool) + Send + Sync>;
pub struct Speech {
    stop: Arc<AtomicBool>,
}
impl Default for Speech {
    fn default() -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(false)),
        }
    }
}
impl Speech {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
    pub fn start(&mut self, model: PathBuf, runtime: PathBuf, emit: SpeechEvent) {
        self.stop();
        self.stop = Arc::new(AtomicBool::new(false));
        let stop = self.stop.clone();
        thread::spawn(move || {
            if let Err(error) = recognize(model, runtime, &stop, &emit) {
                if !stop.load(Ordering::Relaxed) {
                    emit("unsupported", Some(&error), false);
                }
            }
        });
    }
}
impl Drop for Speech {
    fn drop(&mut self) {
        self.stop();
    }
}

struct Vosk {
    _lib: Library,
    model_free: unsafe extern "C" fn(*mut c_void),
    rec_free: unsafe extern "C" fn(*mut c_void),
    accept: unsafe extern "C" fn(*mut c_void, *const i16, c_int) -> c_int,
    result: unsafe extern "C" fn(*mut c_void) -> *const c_char,
    partial: unsafe extern "C" fn(*mut c_void) -> *const c_char,
    model: *mut c_void,
    rec: *mut c_void,
}
impl Drop for Vosk {
    fn drop(&mut self) {
        unsafe {
            (self.rec_free)(self.rec);
            (self.model_free)(self.model);
        }
    }
}
impl Vosk {
    unsafe fn open(model: PathBuf, runtime: PathBuf, rate: f32) -> Result<Self, String> {
        let name = if cfg!(target_os = "windows") {
            "libvosk.dll"
        } else if cfg!(target_os = "macos") {
            "libvosk.dylib"
        } else {
            "libvosk.so"
        };
        #[cfg(target_os = "windows")]
        let library: Library =
            libloading::os::windows::Library::load_with_flags(runtime.join(name), 0x00000008)
                .map_err(|e| format!("Vosk runtime: {e}"))?
                .into();
        #[cfg(not(target_os = "windows"))]
        let library = Library::new(runtime.join(name)).map_err(|e| format!("Vosk runtime: {e}"))?;
        let model_new = *library
            .get::<unsafe extern "C" fn(*const c_char) -> *mut c_void>(b"vosk_model_new\0")
            .map_err(|e| e.to_string())?;
        let rec_new = *library
            .get::<unsafe extern "C" fn(*mut c_void, f32) -> *mut c_void>(b"vosk_recognizer_new\0")
            .map_err(|e| e.to_string())?;
        let model_free = *library
            .get(b"vosk_model_free\0")
            .map_err(|e| e.to_string())?;
        let rec_free = *library
            .get(b"vosk_recognizer_free\0")
            .map_err(|e| e.to_string())?;
        let accept = *library
            .get(b"vosk_recognizer_accept_waveform_s\0")
            .map_err(|e| e.to_string())?;
        let result = *library
            .get(b"vosk_recognizer_result\0")
            .map_err(|e| e.to_string())?;
        let partial = *library
            .get(b"vosk_recognizer_partial_result\0")
            .map_err(|e| e.to_string())?;
        let path = CString::new(model.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let model = model_new(path.as_ptr());
        if model.is_null() {
            return Err("Не удалось открыть модель речи. Выберите распакованную папку Vosk для нужного языка.".into());
        }
        let rec = rec_new(model, rate);
        if rec.is_null() {
            let free: unsafe extern "C" fn(*mut c_void) = model_free;
            free(model);
            return Err("Vosk recognizer".into());
        }
        Ok(Self {
            _lib: library,
            model_free,
            rec_free,
            accept,
            result,
            partial,
            model,
            rec,
        })
    }
}
fn recognize(
    model: PathBuf,
    runtime: PathBuf,
    stop: &Arc<AtomicBool>,
    emit: &SpeechEvent,
) -> Result<(), String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("Микрофон не найден")?;
    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let (sender, receiver) = mpsc::sync_channel::<Vec<i16>>(16);
    let channels = config.channels as usize;
    let vosk = unsafe { Vosk::open(model, runtime, config.sample_rate as f32)? };
    if stop.load(Ordering::Relaxed) {
        return Ok(());
    }
    let error_emit = emit.clone();
    let error_stop = stop.clone();
    let err = move |e: cpal::StreamError| {
        error_emit("denied", Some(&e.to_string()), false);
        error_stop.store(true, Ordering::Relaxed);
    };
    let stream = match format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _| {
                let audio = data
                    .chunks(channels)
                    .map(|c| {
                        (c.iter().sum::<f32>() / channels as f32 * 32767.).clamp(-32768., 32767.)
                            as i16
                    })
                    .collect();
                let _ = sender.try_send(audio);
            },
            err,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _| {
                let audio = data
                    .chunks(channels)
                    .map(|c| (c.iter().map(|v| *v as i32).sum::<i32>() / channels as i32) as i16)
                    .collect();
                let _ = sender.try_send(audio);
            },
            err,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _| {
                let audio = data
                    .chunks(channels)
                    .map(|c| {
                        (c.iter().map(|v| *v as i32 - 32768).sum::<i32>() / channels as i32) as i16
                    })
                    .collect();
                let _ = sender.try_send(audio);
            },
            err,
            None,
        ),
        _ => return Err("Формат микрофона не поддерживается".into()),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    emit("listening", None, false);
    let mut last = String::new();
    while !stop.load(Ordering::Relaxed) {
        let data = match receiver.recv_timeout(Duration::from_millis(150)) {
            Ok(data) => data,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        let final_result =
            unsafe { (vosk.accept)(vosk.rec, data.as_ptr(), data.len() as c_int) > 0 };
        let raw = unsafe {
            if final_result {
                (vosk.result)(vosk.rec)
            } else {
                (vosk.partial)(vosk.rec)
            }
        };
        if raw.is_null() {
            return Err("Vosk result".into());
        }
        let raw = unsafe { CStr::from_ptr(raw) }.to_string_lossy();
        let result: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let text = result[if final_result { "text" } else { "partial" }]
            .as_str()
            .unwrap_or("");
        if !text.is_empty() && (last != text || final_result) {
            emit("transcript", Some(text), final_result);
            last = text.into();
        }
        if final_result {
            emit("listening", None, false);
            last.clear();
        }
    }
    drop(stream);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    // Verify the ABI with actual PCM, without a microphone or network.
    // Use Vosk's official small-en-us-0.15 model and python/example/test.wav.
    #[test]
    #[ignore = "Set EFIR_VOSK_MODEL, EFIR_VOSK_RUNTIME and EFIR_VOSK_WAV"]
    fn offline_runtime_decodes_pcm() {
        let path = |name| PathBuf::from(std::env::var(name).expect(name));
        let wav = std::fs::read(path("EFIR_VOSK_WAV")).unwrap();
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        let mut offset = 12;
        let mut rate = 0;
        let mut pcm = vec![];
        while offset + 8 <= wav.len() {
            let size = u32::from_le_bytes(wav[offset + 4..offset + 8].try_into().unwrap()) as usize;
            let data = &wav[offset + 8..offset + 8 + size];
            match &wav[offset..offset + 4] {
                b"fmt " => {
                    assert_eq!(u16::from_le_bytes(data[..2].try_into().unwrap()), 1);
                    assert_eq!(u16::from_le_bytes(data[2..4].try_into().unwrap()), 1);
                    assert_eq!(u16::from_le_bytes(data[14..16].try_into().unwrap()), 16);
                    rate = u32::from_le_bytes(data[4..8].try_into().unwrap());
                }
                b"data" => pcm.extend(
                    data.chunks_exact(2)
                        .map(|bytes| i16::from_le_bytes(bytes.try_into().unwrap())),
                ),
                _ => {}
            }
            offset += 8 + size + (size % 2);
        }
        assert_eq!(rate, 16000);
        assert!(!pcm.is_empty());
        pcm.extend(vec![0; rate as usize * 2]);
        let recognizer = unsafe {
            Vosk::open(
                path("EFIR_VOSK_MODEL"),
                path("EFIR_VOSK_RUNTIME"),
                rate as f32,
            )
            .unwrap()
        };
        let mut transcript = String::new();
        let mut partial = false;
        for chunk in pcm.chunks(1600) {
            let final_result = unsafe {
                (recognizer.accept)(recognizer.rec, chunk.as_ptr(), chunk.len() as c_int)
            };
            assert!(final_result >= 0);
            let raw = unsafe {
                if final_result > 0 {
                    (recognizer.result)(recognizer.rec)
                } else {
                    (recognizer.partial)(recognizer.rec)
                }
            };
            assert!(!raw.is_null());
            let json: serde_json::Value =
                serde_json::from_str(unsafe { CStr::from_ptr(raw) }.to_str().unwrap()).unwrap();
            if final_result > 0 {
                transcript.push_str(json["text"].as_str().unwrap());
                transcript.push(' ');
            } else {
                partial |= !json["partial"].as_str().unwrap().is_empty();
            }
        }
        assert!(partial, "streaming transcript before end of phrase");
        assert!(
            transcript.contains("one zero zero zero one"),
            "{transcript}"
        );
        assert!(
            transcript.contains("zero one eight zero three"),
            "{transcript}"
        );
        println!("Offline Vosk transcript: {transcript}");
    }
}
