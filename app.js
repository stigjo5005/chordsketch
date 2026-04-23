const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHORD_TEMPLATES = [
  { suffix: "", intervals: [0, 4, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
  { suffix: "7", intervals: [0, 4, 7, 10] },
  { suffix: "maj7", intervals: [0, 4, 7, 11] },
  { suffix: "m7", intervals: [0, 3, 7, 10] },
  { suffix: "sus4", intervals: [0, 5, 7] },
];

const form = document.getElementById("analyzer-form");
const statusPanel = document.getElementById("status");
const audioInput = document.getElementById("audio-file");
const youtubeInput = document.getElementById("youtube-url");
const analyzeButton = document.getElementById("analyze-button");
const demoButton = document.getElementById("demo-button");
const copyButton = document.getElementById("copy-button");
const aiRefineButton = document.getElementById("ai-refine-button");
const printButton = document.getElementById("print-button");
const pdfButton = document.getElementById("pdf-button");
const imageButton = document.getElementById("image-button");

const summaryTitle = document.getElementById("summary-title");
const summaryDuration = document.getElementById("summary-duration");
const summaryBpm = document.getElementById("summary-bpm");
const summaryKey = document.getElementById("summary-key");
const leadSheet = document.getElementById("lead-sheet");
const aiInsights = document.getElementById("ai-insights");
const staffNotation = document.getElementById("staff-notation");
const sectionsSummary = document.getElementById("sections-summary");
const melodyTable = document.getElementById("melody-table");
const chordTimeline = document.getElementById("chord-timeline");
const timelineTemplate = document.getElementById("timeline-item-template");

let latestLeadSheet = "";
let latestAnalysis = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = audioInput.files[0];
  const youtubeUrl = youtubeInput.value.trim();

  if (!file && !youtubeUrl) {
    setStatus("오디오 파일을 선택하거나 유튜브 링크를 먼저 입력해 주세요.", "error");
    return;
  }

  try {
    analyzeButton.disabled = true;

    if (file) {
      setStatus("업로드한 파일을 해석하면서 멜로디와 코드를 추정하는 중입니다...", "loading");
      const analysis = await analyzeAudioSource(file, file.name);
      renderAnalysis(analysis);
      setStatus("분석이 완료되었습니다. 아래 결과를 확인해 보세요.", "success");
      return;
    }

    setStatus("유튜브에서 오디오를 가져오는 중입니다. 잠시만 기다려 주세요...", "loading");
    const downloadedFile = await fetchYoutubeAudio(youtubeUrl);
    setStatus("오디오를 가져왔습니다. 멜로디와 코드를 분석하는 중입니다...", "loading");
    const analysis = await analyzeAudioSource(downloadedFile, downloadedFile.name);
    renderAnalysis(analysis);
    setStatus("유튜브 링크 분석이 완료되었습니다. 결과가 준비되었어요.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`분석 중 문제가 발생했습니다: ${error.message || "알 수 없는 오류"}`, "error");
  } finally {
    analyzeButton.disabled = false;
  }
});

demoButton.addEventListener("click", () => {
  setStatus(
    "보컬이나 메인 멜로디가 선명한 곡에서 가장 잘 동작합니다. 밴드 사운드가 복잡한 곡은 정확한 채보보다는 연습용 스케치에 더 가깝게 나올 수 있어요.",
    "idle"
  );
});

copyButton.addEventListener("click", async () => {
  if (!latestLeadSheet) {
    setStatus("복사할 리드 시트가 아직 없습니다.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(latestLeadSheet);
    setStatus("리드 시트를 클립보드에 복사했습니다.", "success");
  } catch (_error) {
    setStatus("브라우저에서 클립보드 접근을 막았습니다.", "error");
  }
});

printButton?.addEventListener("click", () => {
  if (!latestAnalysis) {
    setStatus("먼저 곡을 분석한 뒤 인쇄용 보기를 열 수 있습니다.", "error");
    return;
  }
  openPrintableView(false);
});

pdfButton?.addEventListener("click", () => {
  if (!latestAnalysis) {
    setStatus("먼저 곡을 분석한 뒤 PDF 저장을 사용할 수 있습니다.", "error");
    return;
  }
  openPrintableView(true);
});

aiRefineButton?.addEventListener("click", async () => {
  if (!latestAnalysis) {
    setStatus("먼저 곡을 분석한 뒤 AI 보정을 실행할 수 있습니다.", "error");
    return;
  }

  try {
    aiRefineButton.disabled = true;
    setStatus("AI가 코드와 구간을 한 번 더 정리하는 중입니다...", "loading");
    const refined = await refineAnalysisWithAI(latestAnalysis);
    applyAIRefinement(refined);
    setStatus("AI 보정이 적용되었습니다.", "success");
  } catch (error) {
    setStatus(`AI 보정에 실패했습니다: ${error.message}`, "error");
  } finally {
    aiRefineButton.disabled = false;
  }
});

imageButton?.addEventListener("click", async () => {
  if (!latestAnalysis) {
    setStatus("먼저 곡을 분석한 뒤 악보 이미지를 저장할 수 있습니다.", "error");
    return;
  }

  try {
    await downloadStaffAsImage();
    setStatus("오선보 이미지를 PNG로 저장했습니다.", "success");
  } catch (error) {
    setStatus(`악보 이미지 저장에 실패했습니다: ${error.message}`, "error");
  }
});

function setStatus(message, tone) {
  statusPanel.textContent = message;
  statusPanel.className = `status-panel ${tone}`;
}

async function fetchYoutubeAudio(url) {
  const response = await fetch("/api/youtube-download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || "유튜브 오디오를 가져오지 못했습니다.");
  }

  const audioResponse = await fetch(payload.audioPath);
  if (!audioResponse.ok) {
    throw new Error("다운로드된 오디오 파일을 열 수 없습니다.");
  }

  const blob = await audioResponse.blob();
  const inferredName = extractFileName(payload.audioPath);
  const extension = inferExtension(blob.type, inferredName);
  const title = sanitizeTitle(payload.title || "youtube-track");
  return new File([blob], `${title}.${extension}`, {
    type: blob.type || "audio/webm",
  });
}

async function refineAnalysisWithAI(analysis) {
  const response = await fetch("/api/ai-refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: analysis.title,
      key: analysis.key,
      bpm: analysis.bpm,
      durationSeconds: analysis.durationSeconds,
      notes: analysis.notes,
      chords: analysis.chords,
      sections: analysis.sections,
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || "AI 보정 응답을 받지 못했습니다.");
  }
  return payload;
}

async function readJsonResponse(response) {
  const rawText = await response.text();
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch (_error) {
    throw new Error(`서버가 JSON 대신 다음 응답을 보냈습니다: ${rawText.slice(0, 140)}`);
  }
}

function extractFileName(path) {
  const pieces = path.split("/");
  return pieces[pieces.length - 1] || "audio.bin";
}

function inferExtension(mimeType, fallbackName) {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";

  const match = fallbackName.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "webm";
}

function sanitizeTitle(title) {
  return title.replace(/[\\/:*?"<>|]/g, "").trim() || "youtube-track";
}

async function analyzeAudioSource(file, displayTitle) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mixed = mixToMono(audioBuffer);
    const maxDuration = 90;
    const sampleCount = Math.min(mixed.length, Math.floor(audioBuffer.sampleRate * maxDuration));
    const trimmed = mixed.subarray(0, sampleCount);

    const pitchFrames = extractPitchFrames(trimmed, audioBuffer.sampleRate);
    const notes = mergePitchFrames(pitchFrames, audioBuffer.sampleRate);
    const bpm = estimateTempo(trimmed, audioBuffer.sampleRate);
    const key = estimateKey(notes);
    const durationSeconds = trimmed.length / audioBuffer.sampleRate;
    const chords = estimateChords(notes, bpm, durationSeconds, key);
    const sections = detectSections(chords, durationSeconds);
    const wasTrimmed = mixed.length !== trimmed.length;
    const leadSheetText = buildLeadSheet({
      title: displayTitle,
      bpm,
      key,
      durationSeconds,
      notes,
      chords,
      sections,
      wasTrimmed,
    });

    return {
      title: displayTitle,
      durationSeconds,
      bpm,
      key,
      notes,
      chords,
      sections,
      leadSheetText,
      wasTrimmed,
    };
  } finally {
    await audioContext.close();
  }
}

function mixToMono(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const mixed = new Float32Array(audioBuffer.length);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < audioBuffer.length; index += 1) {
      mixed[index] += data[index] / channelCount;
    }
  }

  return mixed;
}

function extractPitchFrames(samples, sampleRate) {
  const frameSize = 2048;
  const hopSize = 1024;
  const minFrequency = 82;
  const maxFrequency = 880;
  const minLag = Math.floor(sampleRate / maxFrequency);
  const maxLag = Math.floor(sampleRate / minFrequency);
  const frames = [];

  for (let start = 0; start + frameSize < samples.length; start += hopSize) {
    const frame = samples.subarray(start, start + frameSize);
    const rms = Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / frame.length);

    if (rms < 0.015) {
      frames.push({ time: start / sampleRate, frequency: null });
      continue;
    }

    let bestLag = -1;
    let bestScore = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let correlation = 0;
      for (let index = 0; index < frameSize - lag; index += 1) {
        correlation += frame[index] * frame[index + lag];
      }

      if (correlation > bestScore) {
        bestScore = correlation;
        bestLag = lag;
      }
    }

    if (bestLag === -1 || bestScore <= 0) {
      frames.push({ time: start / sampleRate, frequency: null });
      continue;
    }

    frames.push({
      time: start / sampleRate,
      frequency: sampleRate / bestLag,
    });
  }

  return smoothFrames(frames);
}

function smoothFrames(frames) {
  return frames.map((frame, index) => {
    if (!frame.frequency) return frame;

    const neighbors = [];
    for (let offset = -1; offset <= 1; offset += 1) {
      const candidate = frames[index + offset];
      if (candidate && candidate.frequency) neighbors.push(candidate.frequency);
    }

    neighbors.sort((left, right) => left - right);
    return { ...frame, frequency: neighbors[Math.floor(neighbors.length / 2)] };
  });
}

function mergePitchFrames(frames, sampleRate) {
  const merged = [];

  for (const frame of frames) {
    if (!frame.frequency) continue;

    const note = frequencyToNote(frame.frequency);
    if (!note) continue;

    const previous = merged[merged.length - 1];
    const duration = 1024 / sampleRate;

    if (
      previous &&
      previous.note === note.name &&
      Math.abs(previous.midi - note.midi) <= 1 &&
      frame.time - previous.end < 0.08
    ) {
      previous.end = frame.time + duration;
      previous.samples += 1;
      previous.totalFrequency += frame.frequency;
    } else {
      merged.push({
        note: note.name,
        midi: note.midi,
        start: frame.time,
        end: frame.time + duration,
        samples: 1,
        totalFrequency: frame.frequency,
      });
    }
  }

  return merged
    .map((entry) => ({
      ...entry,
      frequency: entry.totalFrequency / entry.samples,
      duration: entry.end - entry.start,
    }))
    .filter((entry) => entry.duration >= 0.12)
    .slice(0, 96);
}

function frequencyToNote(frequency) {
  if (!frequency || !Number.isFinite(frequency)) return null;

  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return { midi, name: `${NOTE_NAMES[noteIndex]}${octave}` };
}

function estimateTempo(samples, sampleRate) {
  const windowSize = 1024;
  const energies = [];

  for (let start = 0; start + windowSize < samples.length; start += windowSize) {
    let sum = 0;
    for (let index = start; index < start + windowSize; index += 1) {
      sum += samples[index] * samples[index];
    }
    energies.push(Math.sqrt(sum / windowSize));
  }

  const flux = [];
  for (let index = 1; index < energies.length; index += 1) {
    flux.push(Math.max(0, energies[index] - energies[index - 1]));
  }

  let bestBpm = 120;
  let bestValue = -Infinity;

  for (let bpm = 70; bpm <= 180; bpm += 1) {
    const lag = Math.round((60 / bpm) * sampleRate / windowSize);
    let score = 0;
    for (let index = lag; index < flux.length; index += 1) {
      score += flux[index] * flux[index - lag];
    }
    if (score > bestValue) {
      bestValue = score;
      bestBpm = bpm;
    }
  }

  return bestBpm;
}

function estimateKey(notes) {
  if (!notes.length) return "Unknown";

  const pitchClassWeights = Array(12).fill(0);
  for (const note of notes) {
    pitchClassWeights[((note.midi % 12) + 12) % 12] += note.duration;
  }

  const majorTemplate = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorTemplate = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  let best = { score: -Infinity, label: "Unknown" };

  for (let tonic = 0; tonic < 12; tonic += 1) {
    const majorScore = correlationScore(pitchClassWeights, rotate(majorTemplate, tonic));
    if (majorScore > best.score) best = { score: majorScore, label: `${NOTE_NAMES[tonic]} Major` };

    const minorScore = correlationScore(pitchClassWeights, rotate(minorTemplate, tonic));
    if (minorScore > best.score) best = { score: minorScore, label: `${NOTE_NAMES[tonic]} Minor` };
  }

  return best.label;
}

function rotate(array, shift) {
  return array.map((_, index) => array[(index - shift + array.length) % array.length]);
}

function correlationScore(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return score;
}

function estimateChords(notes, bpm, durationSeconds, keyLabel) {
  if (!notes.length) return [];

  const beatDuration = 60 / (bpm || 120);
  const segmentDuration = Math.max(beatDuration * 2, 1.4);
  const segments = [];
  const keyProfile = buildKeyProfile(keyLabel);
  let previousChord = null;

  for (let start = 0; start < durationSeconds; start += segmentDuration) {
    const end = Math.min(start + segmentDuration, durationSeconds);
    const activeNotes = notes.filter((note) => note.end > start && note.start < end);
    if (!activeNotes.length) continue;

    const weights = Array(12).fill(0);
    const midiValues = [];

    for (const note of activeNotes) {
      const pitchClass = ((note.midi % 12) + 12) % 12;
      const overlap = Math.min(note.end, end) - Math.max(note.start, start);
      const weighted = Math.max(0.12, overlap);
      const melodicBonus = note.start >= start && note.start < start + segmentDuration * 0.45 ? 1.15 : 1;
      weights[pitchClass] += weighted * melodicBonus;
      midiValues.push(note.midi);
    }

    const chord = bestChordForWeights(weights, keyProfile, previousChord, midiValues);
    const previousSegment = segments[segments.length - 1];
    if (previousSegment && previousSegment.chord === chord) {
      previousSegment.end = end;
    } else {
      segments.push({ start, end, chord });
    }
    previousChord = chord;
  }

  return segments;
}

function buildKeyProfile(keyLabel) {
  const [tonicName, mode] = keyLabel.split(" ");
  const tonic = NOTE_NAMES.indexOf(tonicName);
  if (tonic < 0) return new Set();

  const scale = mode === "Minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return new Set(scale.map((interval) => (interval + tonic) % 12));
}

function bestChordForWeights(weights, keyProfile, previousChord, midiValues) {
  let best = { score: -Infinity, name: "N.C." };
  const bassPitch = midiValues.length ? ((Math.min(...midiValues) % 12) + 12) % 12 : null;
  const melodicPeak = weights.indexOf(Math.max(...weights));

  for (let root = 0; root < 12; root += 1) {
    for (const template of CHORD_TEMPLATES) {
      let hitScore = 0;
      let missScore = 0;
      let diatonicHits = 0;

      for (let pitch = 0; pitch < 12; pitch += 1) {
        const interval = (pitch - root + 12) % 12;
        const included = template.intervals.includes(interval);
        if (included) {
          hitScore += weights[pitch] * 1.45;
          if (keyProfile.has(pitch)) diatonicHits += 1;
        } else {
          missScore += weights[pitch] * 0.4;
        }
      }

      let score = hitScore - missScore;
      if (bassPitch === root) score += 0.85;
      if (template.intervals.includes((melodicPeak - root + 12) % 12)) score += 0.45;
      score += diatonicHits * 0.12;

      const name = `${NOTE_NAMES[root]}${template.suffix}`;
      if (previousChord === name) score += 0.65;
      if (previousChord && areRelatedChords(previousChord, name)) score += 0.22;

      if (score > best.score) best = { score, name };
    }
  }

  return best.name;
}

function areRelatedChords(left, right) {
  const leftRoot = NOTE_NAMES.indexOf(parseChordRoot(left));
  const rightRoot = NOTE_NAMES.indexOf(parseChordRoot(right));
  if (leftRoot < 0 || rightRoot < 0) return false;
  const distance = Math.abs(leftRoot - rightRoot) % 12;
  return distance === 5 || distance === 7 || distance === 2;
}

function parseChordRoot(chordName) {
  if (typeof chordName !== "string" || !chordName) return "";
  return chordName[1] === "#" ? chordName.slice(0, 2) : chordName.slice(0, 1);
}

function detectSections(chords, durationSeconds) {
  if (!chords.length) return [];

  const windowSeconds = Math.max(6, Math.min(12, durationSeconds / 6 || 8));
  const rawSections = [];

  for (let start = 0; start < durationSeconds; start += windowSeconds) {
    const end = Math.min(start + windowSeconds, durationSeconds);
    const windowChords = chords
      .filter((segment) => segment.end > start && segment.start < end)
      .map((segment) => segment.chord);

    if (!windowChords.length) continue;

    const signature = windowChords.slice(0, 4).join("-");
    rawSections.push({
      start,
      end,
      chords: windowChords,
      signature,
      label: "",
    });
  }

  const signatureMap = new Map();
  let nextLabelIndex = 0;

  for (const section of rawSections) {
    if (!signatureMap.has(section.signature)) {
      signatureMap.set(section.signature, sectionLabel(nextLabelIndex));
      nextLabelIndex += 1;
    }
    section.label = signatureMap.get(section.signature);
  }

  const merged = [];
  for (const section of rawSections) {
    const previous = merged[merged.length - 1];
    if (previous && previous.label === section.label) {
      previous.end = section.end;
      previous.chords = uniqueChords([...previous.chords, ...section.chords]);
    } else {
      merged.push({
        ...section,
        chords: uniqueChords(section.chords),
      });
    }
  }

  return merged;
}

function sectionLabel(index) {
  return String.fromCharCode(65 + (index % 26));
}

function uniqueChords(chords) {
  return [...new Set(chords)];
}

function buildLeadSheet({ title, bpm, key, durationSeconds, notes, chords, sections, wasTrimmed }) {
  const noteLine = notes.slice(0, 24).map((note) => `${formatTime(note.start)} ${note.note}`).join(" | ");
  const chordLine = chords.slice(0, 16).map((chord) => `[${formatTime(chord.start)}] ${chord.chord}`).join("  ");
  const sectionLine = sections
    .slice(0, 8)
    .map((section) => `${section.label} ${formatTime(section.start)}-${formatTime(section.end)} ${section.chords.join(" / ")}`)
    .join("\n");

  return [
    `TITLE  ${title}`,
    `TIME   ${formatDuration(durationSeconds)}${wasTrimmed ? " (앞 90초 기준)" : ""}`,
    `BPM    ${bpm}`,
    `KEY    ${key}`,
    "",
    "SECTIONS",
    sectionLine || "구간 추정 없음",
    "",
    "CHORDS",
    chordLine || "코드 추정 없음",
    "",
    "MELODY",
    noteLine || "멜로디 추정 없음",
    "",
    "NOTE",
    "이 결과는 연습용 스케치 기준의 간단 추정본입니다.",
  ].join("\n");
}

function renderAnalysis(analysis) {
  latestAnalysis = analysis;
  latestLeadSheet = analysis.leadSheetText;
  summaryTitle.textContent = analysis.title;
  summaryDuration.textContent = `${formatDuration(analysis.durationSeconds)}${analysis.wasTrimmed ? " (일부)" : ""}`;
  summaryBpm.textContent = `${analysis.bpm} BPM`;
  summaryKey.textContent = analysis.key;
  leadSheet.textContent = analysis.leadSheetText;
  renderAIInsights(analysis.aiRefinement);
  renderStaffNotation(analysis.notes, analysis.chords, analysis.key);
  renderSections(analysis.sections);
  renderMelodyTable(analysis.notes);
  renderChordTimeline(analysis.chords);
}

function applyAIRefinement(refined) {
  if (!latestAnalysis) return;

  const nextSections = (refined.refined_sections || []).map((section) => ({
    label: section.label,
    start: Number(section.start),
    end: Number(section.end),
    summary: section.summary,
    chords: section.chords || [],
  }));

  const nextChords = (refined.refined_chords || []).map((segment) => ({
    start: Number(segment.start),
    end: Number(segment.end),
    chord: segment.chord,
  }));

  latestAnalysis = {
    ...latestAnalysis,
    key: refined.refined_key || latestAnalysis.key,
    chords: nextChords.length ? nextChords : latestAnalysis.chords,
    sections: nextSections.length ? nextSections : latestAnalysis.sections,
    aiRefinement: {
      confidenceNote: refined.confidence_note || "",
      performanceTips: refined.performance_tips || [],
      model: refined.model || "",
    },
  };

  latestAnalysis.leadSheetText = buildLeadSheet({
    title: latestAnalysis.title,
    bpm: latestAnalysis.bpm,
    key: latestAnalysis.key,
    durationSeconds: latestAnalysis.durationSeconds,
    notes: latestAnalysis.notes,
    chords: latestAnalysis.chords,
    sections: latestAnalysis.sections,
    wasTrimmed: latestAnalysis.wasTrimmed,
  });

  renderAnalysis(latestAnalysis);
}

function renderStaffNotation(notes, chords, key) {
  if (!notes.length) {
    staffNotation.className = "staff-shell empty";
    staffNotation.textContent = "감지된 멜로디 노트가 없습니다.";
    return;
  }

  const VexFlow = window.Vex?.Flow;
  if (!VexFlow) {
    staffNotation.className = "staff-shell empty";
    staffNotation.textContent = "오선보 렌더링 라이브러리를 불러오지 못했습니다.";
    return;
  }

  const visibleNotes = notes.slice(0, 16);
  const width = Math.max(760, visibleNotes.length * 62);
  const height = 220;

  staffNotation.className = "staff-shell";
  staffNotation.innerHTML = `
    <div class="staff-caption">
      <span>키: ${key}</span>
      ${chords.slice(0, 6).map((segment) => `<span>${segment.chord}</span>`).join("") || "<span>코드 추정 없음</span>"}
    </div>
    <div id="staff-canvas"></div>
  `;

  const VF = VexFlow;
  const container = document.getElementById("staff-canvas");
  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(width, height);

  const context = renderer.getContext();
  context.setFont("Arial", 10, "").setBackgroundFillStyle("#fffdf9");

  const stave = new VF.Stave(18, 40, width - 36);
  stave.addClef("treble").addTimeSignature("4/4");
  stave.setContext(context).draw();

  const staveNotes = visibleNotes.map((note, index) => {
    const keyName = midiToVexKey(note.midi);
    const staveNote = new VF.StaveNote({
      clef: "treble",
      keys: [keyName],
      duration: inferVexDuration(note.duration),
    });

    if (keyName.includes("#")) staveNote.addModifier(new VF.Accidental("#"), 0);

    const activeChord = chords.find((segment) => note.start >= segment.start && note.start < segment.end);
    const prevChord = index > 0
      ? chords.find((segment) => visibleNotes[index - 1].start >= segment.start && visibleNotes[index - 1].start < segment.end)
      : null;

    if (activeChord && activeChord.chord !== prevChord?.chord) {
      staveNote.addModifier(
        new VF.Annotation(activeChord.chord)
          .setFont("Arial", 13, "bold")
          .setVerticalJustification(VF.Annotation.VerticalJustify.TOP),
        0
      );
    }

    return staveNote;
  });

  const voice = new VF.Voice({ num_beats: staveNotes.length, beat_value: 4 });
  voice.setStrict(false);
  voice.addTickables(staveNotes);
  new VF.Formatter().joinVoices([voice]).format([voice], width - 72);
  voice.draw(context, stave);
}

function renderSections(sections) {
  if (!sections.length) {
    sectionsSummary.className = "sections-shell empty";
    sectionsSummary.textContent = "구간을 나눌 만큼 충분한 코드 패턴이 감지되지 않았습니다.";
    return;
  }

  sectionsSummary.className = "sections-shell";
  sectionsSummary.innerHTML = sections
    .slice(0, 8)
    .map(
      (section) => `
        <article class="section-card">
          <span class="section-label">구간 ${section.label}</span>
          <strong>${formatTime(section.start)} - ${formatTime(section.end)}</strong>
          <p>${section.summary ? `${escapeHtml(section.summary)}<br />` : ""}${escapeHtml(section.chords.join("  /  "))}</p>
        </article>
      `
    )
    .join("");
}

function renderAIInsights(aiRefinement) {
  if (!aiRefinement) {
    aiInsights.className = "insights-shell empty";
    aiInsights.textContent = "AI 보정을 실행하면 코드 보정 메모와 연주 팁이 여기에 표시됩니다.";
    return;
  }

  const tips = (aiRefinement.performanceTips || [])
    .map((tip) => `<li>${escapeHtml(tip)}</li>`)
    .join("");

  aiInsights.className = "insights-shell";
  aiInsights.innerHTML = `
    <article class="insight-card">
      <span class="insight-label">보정 메모</span>
      <p>${escapeHtml(aiRefinement.confidenceNote || "AI 보정 메모가 없습니다.")}</p>
      <p class="insight-model">${escapeHtml(aiRefinement.model || "")}</p>
    </article>
    <article class="insight-card">
      <span class="insight-label">연주 팁</span>
      <ul>${tips || "<li>추가 팁이 없습니다.</li>"}</ul>
    </article>
  `;
}

function renderMelodyTable(notes) {
  if (!notes.length) {
    melodyTable.className = "table-shell empty";
    melodyTable.textContent = "감지된 멜로디 노트가 없습니다.";
    return;
  }

  const rows = notes.slice(0, 24).map((note) => `
    <tr>
      <td>${formatTime(note.start)}</td>
      <td>${note.note}</td>
      <td>${note.frequency.toFixed(1)} Hz</td>
      <td>${note.duration.toFixed(2)} s</td>
    </tr>
  `).join("");

  melodyTable.className = "table-shell";
  melodyTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>시작</th>
          <th>노트</th>
          <th>주파수</th>
          <th>길이</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderChordTimeline(chords) {
  if (!chords.length) {
    chordTimeline.className = "timeline empty";
    chordTimeline.textContent = "감지된 코드 블록이 없습니다.";
    return;
  }

  chordTimeline.className = "timeline";
  chordTimeline.innerHTML = "";

  chords.slice(0, 18).forEach((segment) => {
    const node = timelineTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".time").textContent = `${formatTime(segment.start)} - ${formatTime(segment.end)}`;
    node.querySelector(".chord").textContent = segment.chord;
    chordTimeline.appendChild(node);
  });
}

function openPrintableView(autoPrint) {
  const printableWindow = window.open("", "_blank", "noopener,noreferrer,width=1100,height=900");
  if (!printableWindow || !latestAnalysis) {
    setStatus("브라우저가 인쇄용 창 열기를 차단했습니다.", "error");
    return;
  }

  printableWindow.document.write(buildPrintableHtml(latestAnalysis, autoPrint));
  printableWindow.document.close();
}

function buildPrintableHtml(analysis, autoPrint) {
  const melodyRows = analysis.notes.slice(0, 24).map((note) => `
    <tr>
      <td>${formatTime(note.start)}</td>
      <td>${note.note}</td>
      <td>${note.frequency.toFixed(1)} Hz</td>
      <td>${note.duration.toFixed(2)} s</td>
    </tr>
  `).join("");

  const chordChips = analysis.chords.slice(0, 18).map((segment) => `
    <div class="chip">
      <strong>${segment.chord}</strong>
      <span>${formatTime(segment.start)} - ${formatTime(segment.end)}</span>
    </div>
  `).join("");

  const sectionsHtml = analysis.sections.slice(0, 8).map((section) => `
    <div class="chip">
      <strong>${section.label}</strong>
      <span>${formatTime(section.start)} - ${formatTime(section.end)}</span>
      <span>${escapeHtml(section.chords.join(" / "))}</span>
    </div>
  `).join("");

  return `<!DOCTYPE html>
  <html lang="ko">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(analysis.title)} | 인쇄용 리드 시트</title>
      <style>
        body { font-family: Arial, sans-serif; color: #1f1f1a; margin: 0; background: #fff; }
        .sheet { width: min(980px, calc(100% - 48px)); margin: 0 auto; padding: 32px 0 48px; }
        .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 2px solid #1f1f1a; padding-bottom: 18px; }
        h1 { margin: 0; font-size: 32px; }
        .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
        .meta article { border: 1px solid #bbb; padding: 12px; border-radius: 10px; }
        .meta span { display: block; font-size: 12px; color: #555; text-transform: uppercase; }
        .meta strong { display: block; margin-top: 8px; font-size: 18px; }
        .block { margin-top: 24px; }
        pre { white-space: pre-wrap; border: 1px solid #bbb; padding: 16px; border-radius: 10px; background: #faf8f3; }
        .chips { display: flex; flex-wrap: wrap; gap: 10px; }
        .chip { border: 1px solid #bbb; border-radius: 16px; padding: 10px 14px; }
        .chip strong, .chip span { display: block; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #ddd; }
        .hint { margin-top: 14px; color: #666; font-size: 13px; }
        @media print { .hint { display: none; } body { margin: 0; } .sheet { width: auto; padding: 16mm; } }
      </style>
    </head>
    <body>
      <div class="sheet">
        <div class="header">
          <div>
            <h1>${escapeHtml(analysis.title)}</h1>
            <p>멜로디, 기타 코드, 구간 요약이 정리된 연습용 리드 시트입니다.</p>
          </div>
          <div class="hint">${autoPrint ? "인쇄 창에서 PDF로 저장을 선택해 주세요." : "브라우저 인쇄 기능으로 출력하거나 PDF로 저장할 수 있습니다."}</div>
        </div>
        <div class="meta">
          <article><span>길이</span><strong>${formatDuration(analysis.durationSeconds)}</strong></article>
          <article><span>템포</span><strong>${analysis.bpm} BPM</strong></article>
          <article><span>키</span><strong>${escapeHtml(analysis.key)}</strong></article>
        </div>
        <section class="block">
          <h2>리드 시트</h2>
          <pre>${escapeHtml(analysis.leadSheetText)}</pre>
        </section>
        <section class="block">
          <h2>구간 요약</h2>
          <div class="chips">${sectionsHtml || "<div class='chip'><strong>구간 추정 없음</strong></div>"}</div>
        </section>
        <section class="block">
          <h2>코드 진행</h2>
          <div class="chips">${chordChips || "<div class='chip'><strong>코드 추정 없음</strong></div>"}</div>
        </section>
        <section class="block">
          <h2>멜로디 노트</h2>
          <table>
            <thead>
              <tr><th>시작</th><th>노트</th><th>주파수</th><th>길이</th></tr>
            </thead>
            <tbody>${melodyRows || "<tr><td colspan='4'>감지된 멜로디 노트가 없습니다.</td></tr>"}</tbody>
          </table>
        </section>
      </div>
      ${autoPrint ? "<script>window.addEventListener('load', () => window.print())<\/script>" : ""}
    </body>
  </html>`;
}

async function downloadStaffAsImage() {
  const svgNode = staffNotation.querySelector("svg");
  if (!svgNode) {
    throw new Error("저장할 오선보가 아직 없습니다.");
  }

  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(svgNode);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = image.width * 2;
    canvas.height = image.height * 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffdf9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    const fileName = sanitizeTitle(latestAnalysis?.title || "staff") || "staff";
    link.href = pngUrl;
    link.download = `${fileName}-staff.png`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("SVG 이미지를 읽지 못했습니다."));
    image.src = src;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remain = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remain}`;
}

function formatTime(seconds) {
  return seconds.toFixed(1).padStart(4, "0");
}

function midiToVexKey(midi) {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIndex].toLowerCase()}/${octave}`;
}

function inferVexDuration(durationSeconds) {
  if (durationSeconds >= 0.9) return "h";
  if (durationSeconds >= 0.45) return "q";
  if (durationSeconds >= 0.23) return "8";
  return "16";
}
