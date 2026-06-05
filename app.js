import { GoogleGenerativeAI } from "@google/generative-ai";

// Local Application State
let students = [];
let selectedStudentIndex = null;
let selectedKeywords = new Set();
let config = {
  apiKey: '',
  model: 'gemini-2.5-flash'
};
let saveTimeout = null;

// DOM Elements
const searchInput = document.getElementById('search-input');
const studentList = document.getElementById('student-list');
const addStudentBtn = document.getElementById('add-student-btn');
const deleteStudentBtn = document.getElementById('delete-student-btn');
const noStudentSelected = document.getElementById('no-student-selected');
const studentDetailPanel = document.getElementById('student-detail-panel');

// Student Form Inputs
const studentNameInput = document.getElementById('student-name');
const studentIdInput = document.getElementById('student-id');
const studentContactInput = document.getElementById('student-contact');
const studentGradeInput = document.getElementById('student-grade');
const studentNotesInput = document.getElementById('student-notes');
const syncStatus = document.getElementById('sync-status');

// CSV Web Interactions
const importBtn = document.getElementById('import-btn');
const exportBtn = document.getElementById('export-btn');
const csvFileInput = document.getElementById('csv-file-input');

// Letter Generation & Editor
const keywordButtons = document.querySelectorAll('.keyword-btn');
const generateBtn = document.getElementById('generate-btn');
const recommendationEditor = document.getElementById('recommendation-text');
const copyBtn = document.getElementById('copy-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMessage = document.getElementById('loading-message');
const apiStatusText = document.getElementById('api-status-text');
const apiStatusDot = document.querySelector('.connection-status .status-dot');

// Settings Modal
const settingsBtn = document.getElementById('open-settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const apiKeyInput = document.getElementById('settings-api-key');
const modelSelect = document.getElementById('settings-model');

// Toast Notification Helper
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  
  // Clone to restart animation if clicked repeatedly
  const newToast = toast.cloneNode(true);
  toast.parentNode.replaceChild(newToast, toast);
  
  setTimeout(() => {
    newToast.classList.add('hidden');
  }, 2500);
}

// Custom CSV Parser (Same logic as desktop)
function parseCSV(text) {
  if (text.startsWith('\ufeff')) {
    text = text.substring(1);
  }
  const lines = [];
  let row = [""];
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push("");
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      lines.push(row);
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }
  
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  
  return lines;
}

// Custom CSV Stringifier (Same logic as desktop)
function stringifyCSV(rows) {
  return rows.map(row => {
    return row.map(cell => {
      let val = String(cell || '');
      if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(',');
  }).join('\n');
}

// 1. INITIALIZATION & CONFIG LOADING (Local Storage)
function initApp() {
  loadConfig();
  updateSettingsUI();
  updateApiStatus();
  
  loadStudentDatabase();
  setupEventListeners();
}

function loadConfig() {
  try {
    const savedConfig = localStorage.getItem('ku_recommendation_config');
    if (savedConfig) {
      config = { ...config, ...JSON.parse(savedConfig) };
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

function saveConfig(newConfig) {
  try {
    config = { ...config, ...newConfig };
    localStorage.setItem('ku_recommendation_config', JSON.stringify(config));
    return { success: true };
  } catch (err) {
    console.error('Error saving config:', err);
    return { success: false, error: err.message };
  }
}

function updateSettingsUI() {
  apiKeyInput.value = config.apiKey || '';
  modelSelect.value = config.model || 'gemini-2.5-flash';
}

function updateApiStatus() {
  if (config.apiKey) {
    apiStatusDot.className = 'status-dot green';
    apiStatusText.textContent = `Gemini 활성화 (${config.model})`;
  } else {
    apiStatusDot.className = 'status-dot yellow';
    apiStatusText.textContent = 'Gemini 대기 중 (API Key 없음)';
  }
}

// 2. STUDENT DATABASE OPERATIONS (Local Storage)
function loadStudentDatabase() {
  try {
    const savedStudents = localStorage.getItem('ku_recommendation_students');
    if (savedStudents) {
      students = JSON.parse(savedStudents);
    } else {
      students = [];
    }
    renderStudentList();
    selectStudent(null);
  } catch (err) {
    console.error('Failed to load students:', err);
    showToast('학생 정보를 불러오는데 실패했습니다.');
  }
}

function saveStudents() {
  try {
    localStorage.setItem('ku_recommendation_students', JSON.stringify(students));
    return { success: true };
  } catch (err) {
    console.error('Failed to save students:', err);
    return { success: false, error: err.message };
  }
}

// Render student list in sidebar
function renderStudentList(filterText = '') {
  studentList.innerHTML = '';
  const query = filterText.toLowerCase().trim();
  
  students.forEach((student, index) => {
    if (query && !student.name.toLowerCase().includes(query) && !student.id.includes(query)) {
      return;
    }
    
    const li = document.createElement('li');
    li.className = 'student-item';
    if (selectedStudentIndex === index) {
      li.classList.add('active');
    }
    
    li.innerHTML = `
      <div class="student-name-row">
        <span>${student.name || '이름 없음'}</span>
      </div>
      <div class="student-id-sub">${student.id || '학번 없음'}</div>
    `;
    
    li.addEventListener('click', () => {
      selectStudent(index);
    });
    
    studentList.appendChild(li);
  });
}

// Select student
function selectStudent(index) {
  selectedStudentIndex = index;
  renderStudentList(searchInput.value);

  if (index === null) {
    noStudentSelected.classList.remove('hidden');
    studentDetailPanel.classList.add('hidden');
    selectedKeywords.clear();
    updateKeywordButtons();
    recommendationEditor.value = '';
    return;
  }
  
  const student = students[index];
  
  noStudentSelected.classList.add('hidden');
  studentDetailPanel.classList.remove('hidden');
  
  studentNameInput.value = student.name || '';
  studentIdInput.value = student.id || '';
  studentContactInput.value = student.contact || '';
  studentGradeInput.value = student.grade || '';
  studentNotesInput.value = student.notes || '';
  
  selectedKeywords.clear();
  updateKeywordButtons();
  recommendationEditor.value = '';
}

// Debounced Autosave to localStorage
function queueAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  
  syncStatus.textContent = '저장 중...';
  syncStatus.style.borderColor = 'var(--ku-gold)';
  syncStatus.style.color = 'var(--ku-gold)';
  
  saveTimeout = setTimeout(() => {
    const result = saveStudents();
    if (result.success) {
      syncStatus.textContent = '저장 완료';
      syncStatus.style.borderColor = 'green';
      syncStatus.style.color = 'green';
      setTimeout(() => {
        if (syncStatus.textContent === '저장 완료') {
          syncStatus.textContent = '자동 저장 활성';
          syncStatus.style.borderColor = 'var(--ku-gold)';
          syncStatus.style.color = 'var(--ku-gold)';
        }
      }, 1500);
    } else {
      syncStatus.textContent = '저장 실패';
      syncStatus.style.borderColor = '#B22222';
      syncStatus.style.color = '#B22222';
      showToast('저장에 실패했습니다: ' + result.error);
    }
  }, 700);
}

function handleFormInput() {
  if (selectedStudentIndex === null) return;
  
  const student = students[selectedStudentIndex];
  student.name = studentNameInput.value.trim();
  student.id = studentIdInput.value.trim();
  student.contact = studentContactInput.value.trim();
  student.grade = studentGradeInput.value.trim();
  student.notes = studentNotesInput.value.trim();
  
  renderStudentList(searchInput.value);
  queueAutoSave();
}

// 3. KEYWORD MANAGMENT
function updateKeywordButtons() {
  keywordButtons.forEach(btn => {
    const keyword = btn.getAttribute('data-keyword');
    if (selectedKeywords.has(keyword)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// 4. RECOMMENDATION LETTER GENERATION (Via Browser SDK)
async function generateLetter() {
  if (selectedStudentIndex === null) {
    showToast('선택된 학생이 없습니다.');
    return;
  }
  
  if (selectedKeywords.size === 0) {
    showToast('최소 한 개 이상의 키워드를 선택해주세요.');
    return;
  }
  
  const student = students[selectedStudentIndex];
  if (!student.name) {
    showToast('학생의 이름을 입력해야 추천서 작성이 가능합니다.');
    return;
  }
  
  const keywords = Array.from(selectedKeywords);
  
  loadingOverlay.classList.remove('hidden');
  if (config.apiKey) {
    loadingMessage.textContent = 'Gemini가 품격 있는 추천서를 집필 중입니다...';
  } else {
    loadingMessage.textContent = '로컬 템플릿으로 추천서를 구성 중입니다...';
  }
  
  try {
    if (!config.apiKey) {
      throw new Error('Gemini API Key가 설정되지 않았습니다. 설정(⚙️) 메뉴에서 API Key를 먼저 입력해주세요.');
    }
    
    // Initialize Gemini browser-side
    const genAI = new GoogleGenerativeAI(config.apiKey);
    const selectedModel = config.model || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: selectedModel });
    
    const prompt = `
당신은 고려대학교 국어국문학과에 근무하고 있는 명망 높은 교수입니다.
지도 학생인 '${student.name}' 학생을 위해 대학원 진학 또는 취업용 추천서를 정성스럽게 작성해야 합니다.
학생의 정보와 교수가 선택한 핵심 키워드(특성)를 바탕으로, 국어국문학과 교수 특유의 지적이고 유려하며 정성스러운 한국어 문체로 추천서를 작성해주세요.

[학생 정보]
- 이름: ${student.name}
- 학번: ${student.id}
- 학업성적: ${student.grade || '기재 안 됨'}
- 특이사항 및 성향: ${student.notes || '특별히 기재된 내용 없음'}

[교수가 선택한 이 학생의 핵심 키워드]
${keywords.join(', ')}

[작성 지침]
1. 추천서의 형식은 정중한 서한 형식을 갖추어야 합니다.
2. 문체는 '하십시요체'(-습니다, -합니다)를 사용하고, 국어국문학과 교수로서 격조 높고 우아한 어휘를 선택하여 품격을 높이십시오.
3. 고려대학교 국어국문학과 학생으로서의 우수성을 간접적으로 드러내 주십시오.
4. 단순 나열이 아닌, 학생 정보에 명시된 '학업성적'과 '특이사항'을 자연스럽게 풀어서 서술하십시오.
5. 선택된 키워드(${keywords.join(', ')})들이 추천서 본문에 핵심적인 설득 근거로 입체감 있게 녹아들도록 하십시오. (예: "성실함"이 키워드라면 학업적 끈기나 세미나 준비 태도와 연계하여 서술)
6. 추천 대상자의 가능성을 진심으로 지지하고 추천하는 정성스럽고 설득력 있는 단락(서론-본론-결론)으로 구성하십시오.
7. 글의 맨 마지막에는 "고려대학교 국어국문학과 교수 [교수명]"의 형식으로 마무리할 수 있게 서명란을 넣어주십시오. (교수명 부분은 빈칸 또는 공란으로 비워두거나 'OOO'로 처리하십시오.)
8. AI가 작성한 티가 나는 상투적인 문구나 안내 멘트(예: "네, 작성해 드리겠습니다" 등)는 완전히 제외하고 오직 추천서 본문만 출력하십시오.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    recommendationEditor.value = text.trim();
    showToast('추천서가 성공적으로 작성되었습니다.');
  } catch (err) {
    console.error('Generation error:', err);
    const fallbackText = generateFallbackLetter(student, keywords);
    recommendationEditor.value = fallbackText;
    
    alert(`[Gemini API 호출 실패 안내]\n\n오류 원인: ${err.message}\n\n* API Key 설정이 올바르지 않거나 쿼타가 부족하여 AI 호출 대신 로컬에 저장된 기본 템플릿 문구로 작성되었습니다. 우측 하단 ⚙️ 설정에서 올바른 API Key를 새로 발급받아 입력해주세요.`);
  } finally {
    loadingOverlay.classList.add('hidden');
  }
}

// Fallback letter generator for browser offline/error (Same logic as desktop)
function generateFallbackLetter(student, keywords) {
  const keywordStrengths = {
    '성실함': '매 학기 단 한 차례의 지각이나 결석도 없이 묵묵히 자신의 학업에 임하는 성실함은 동료 학생들에게 큰 귀감이 되었습니다.',
    '열정적임': '학문에 대한 호기심이 남달라 정규 강의 외에도 스스로 연구 주제를 발굴하고 탐구하는 뜨거운 학문적 열정을 보여주었습니다.',
    '리더십 있음': '학과 내 학술 소모임 및 토론 수업에서 급우들의 다양한 의견을 조율하고 올바른 방향으로 이끄는 뛰어난 리더십을 발휘하였습니다.',
    '창의적임': '문학 텍스트를 분석하거나 창작 논의를 진행할 때, 기존의 틀에 갇히지 않고 늘 새롭고 신선한 시각을 제시하는 창의성이 돋보였습니다.',
    '책임감': '주어진 연구 과제나 소모임 프로젝트에서 맡은 바 책임을 끝까지 다하며, 어려운 상황 속에서도 묵묵히 결과를 만들어내는 책임감이 뛰어납니다.',
    '재능있음': '국어학 및 국문학 전반에 걸친 이해도가 매우 깊고, 텍스트를 분석하고 비평하는 능력이 타고난 학문적 재능을 지니고 있습니다.',
    '신뢰가능함': '언행이 항상 바르고 약속을 지키며, 교수와 동료 학우들 사이에서 깊은 신뢰를 받는 든든한 학문적 동반자 같은 학생입니다.',
    '인성이 훌륭함': '타인을 배려하는 따뜻한 성품을 지녔으며, 항상 겸손하고 예의 바른 태도로 학과의 분위기를 밝고 긍정적으로 만드는 인성을 갖추었습니다.'
  };

  const selectedStrengths = keywords.map(kw => keywordStrengths[kw] || '').filter(Boolean).join('\n\n');

  return `추천서

수신: 관련 기관 및 대학원 입학처 담당자 귀하

안녕하십니까. 고려대학교 국어국문학과 교수입니다.

본 교수는 저희 학과에서 수학한 ${student.name} 학생(학번: ${student.id})을 귀 기관에 기쁜 마음으로 추천하고자 이 글을 씁니다.

${student.name} 학생은 학업성적이 ${student.grade || '우수하'}며, 학과의 다양한 교육 과정에 성실히 임해 온 재원입니다. ${student.notes ? `특히 '${student.notes}'와(과) 같은 특성과 활동 이력이 보여주듯, 학과 수업에 국한되지 않고 다방면으로 자신의 가능성을 입증해 보였습니다.` : ''}

본 교수가 관찰한 ${student.name} 학생의 가장 큰 강점은 다음과 같습니다.

${selectedStrengths || '이 학생은 다방면에서 뛰어난 적응력과 학문적 깊이를 보여주었습니다.'}

이러한 학업적 성취와 인격적 성숙함을 바탕으로, ${student.name} 학생은 귀 기관의 발전에 크게 기여할 수 있는 역량과 자질을 갖추었다고 확신합니다. 앞날이 촉망받는 본 학생이 더 넓은 세상에서 자신의 꿈을 펼칠 수 있도록 귀 기관에서 기회를 부여해 주시기를 간곡히 부탁드립니다.

2026년 6월 5일

고려대학교 국어국문학과 교수 (서명/날인)`;
}

// 5. CSV WEB FILE INTERACTION
function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;

  const confirmImport = confirm("CSV 파일을 가져오면 브라우저에 저장된 기존 학생 데이터가 대체됩니다. 계속하시겠습니까?");
  if (!confirmImport) {
    csvFileInput.value = ''; // Clear file input
    return;
  }

  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const text = event.target.result;
      const rows = parseCSV(text);
      
      if (rows.length === 0) {
        showToast("가져올 수 있는 데이터가 없습니다.");
        return;
      }

      const importedStudents = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length >= 2 && row[1].trim() !== '') {
          importedStudents.push({
            id: row[0] || '',
            name: row[1] || '',
            contact: row[2] || '',
            grade: row[3] || '',
            notes: row[4] || ''
          });
        }
      }
      
      students = importedStudents;
      saveStudents();
      renderStudentList();
      selectStudent(null);
      showToast(`${students.length}명의 학생 정보를 성공적으로 가져왔습니다.`);
    } catch (err) {
      console.error('Import error:', err);
      alert('CSV 파싱 중 에러가 발생했습니다. 헤더 규격(학번, 이름, 연락처, 학업성적, 특이사항)을 확인해주세요.');
    } finally {
      csvFileInput.value = ''; // Reset input
    }
  };
  
  reader.readAsText(file, 'utf-8');
}

function exportCSV() {
  if (students.length === 0) {
    showToast("내보낼 학생 정보가 없습니다.");
    return;
  }

  try {
    const header = ['학번', '이름', '연락처', '학업성적', '특이사항'];
    const rows = [header];
    
    students.forEach(s => {
      rows.push([s.id, s.name, s.contact, s.grade, s.notes]);
    });
    
    const csvContent = stringifyCSV(rows);
    // Add BOM for Korean Excel compatibility
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "고려대학교_국어국문학과_학생정보.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("CSV 파일이 다운로드 폴더에 저장되었습니다.");
  } catch (err) {
    console.error('Export error:', err);
    showToast("파일 내보내기에 실패했습니다.");
  }
}

// 6. EVENT LISTENERS SETUP
function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', () => {
    renderStudentList(searchInput.value);
  });
  
  // Add Student
  addStudentBtn.addEventListener('click', () => {
    const newStudent = {
      id: '',
      name: '새 학생',
      contact: '',
      grade: '',
      notes: ''
    };
    students.push(newStudent);
    renderStudentList(searchInput.value);
    selectStudent(students.length - 1);
    queueAutoSave();
    studentNameInput.focus();
    studentNameInput.select();
  });
  
  // Delete Student
  deleteStudentBtn.addEventListener('click', () => {
    if (selectedStudentIndex === null) return;
    
    const confirmDelete = confirm(`'${students[selectedStudentIndex].name}' 학생 정보를 삭제하시겠습니까?`);
    if (confirmDelete) {
      students.splice(selectedStudentIndex, 1);
      selectStudent(null);
      renderStudentList(searchInput.value);
      queueAutoSave();
      showToast('학생 정보가 삭제되었습니다.');
    }
  });
  
  // Form input changes
  const formInputs = [studentNameInput, studentIdInput, studentContactInput, studentGradeInput, studentNotesInput];
  formInputs.forEach(input => {
    input.addEventListener('input', handleFormInput);
  });
  
  // CSV Upload/Download Hooks
  importBtn.addEventListener('click', () => {
    csvFileInput.click();
  });
  csvFileInput.addEventListener('change', importCSV);
  exportBtn.addEventListener('click', exportCSV);
  
  // Keyword selections
  keywordButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const keyword = btn.getAttribute('data-keyword');
      if (selectedKeywords.has(keyword)) {
        selectedKeywords.delete(keyword);
      } else {
        selectedKeywords.add(keyword);
      }
      updateKeywordButtons();
    });
  });
  
  // Generate recommendations
  generateBtn.addEventListener('click', generateLetter);
  
  // Clipboard copy
  copyBtn.addEventListener('click', () => {
    const text = recommendationEditor.value;
    if (!text.trim()) {
      showToast('복사할 본문 내용이 없습니다.');
      return;
    }
    
    navigator.clipboard.writeText(text)
      .then(() => {
        showToast('클립보드에 추천서가 복사되었습니다.');
      })
      .catch(err => {
        console.error('Copy failed:', err);
        showToast('복사에 실패했습니다.');
      });
  });
  
  // Settings modal controls
  settingsBtn.addEventListener('click', () => {
    updateSettingsUI();
    settingsModal.classList.remove('hidden');
  });
  
  const closeModal = () => {
    settingsModal.classList.add('hidden');
  };
  
  closeSettingsBtn.addEventListener('click', closeModal);
  
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeModal();
    }
  });
  
  saveSettingsBtn.addEventListener('click', () => {
    const newConfig = {
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value
    };
    
    const result = saveConfig(newConfig);
    if (result.success) {
      updateApiStatus();
      closeModal();
      showToast('설정이 성공적으로 저장되었습니다.');
    } else {
      showToast('설정 저장 실패: ' + result.error);
    }
  });
}

// Start application
initApp();
