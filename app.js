/**
 * AI Digit Studio - Main Application Logic
 * Canvas Drawing, Realtime Digit Inference, History, TTS, Theme Toggle
 */

document.addEventListener('DOMContentLoaded', () => {
    // Canvas Elements
    const canvas = document.getElementById('sketchCanvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const emptyHint = document.getElementById('canvasEmptyHint');
    const gridOverlay = document.getElementById('canvasGridOverlay');
    const miniPreviewCanvas = document.getElementById('miniPreviewCanvas');
    const miniCtx = miniPreviewCanvas.getContext('2d');

    // Tool Controls
    const btnPen = document.getElementById('btnPen');
    const btnEraser = document.getElementById('btnEraser');
    const strokeRange = document.getElementById('strokeRange');
    const strokeDot = document.getElementById('strokeDot');
    const btnUndo = document.getElementById('btnUndo');
    const btnClear = document.getElementById('btnClear');
    const btnPredict = document.getElementById('btnPredict');
    const autoPredictToggle = document.getElementById('autoPredictToggle');

    // Result Elements (Key Requirement: Result & Accuracy Inline)
    const resultAccuracyBadge = document.getElementById('resultAccuracyBadge');
    const largeDigitNumber = document.getElementById('largeDigitNumber');
    const digitStatusText = document.getElementById('digitStatusText');
    const digitSubtext = document.getElementById('digitSubtext');
    const btnCopy = document.getElementById('btnCopy');
    const btnSpeak = document.getElementById('btnSpeak');

    // Candidates & Probabilities
    const candidatesContainer = document.getElementById('candidatesContainer');
    const probBarsContainer = document.getElementById('probBarsContainer');
    const historyList = document.getElementById('historyList');
    const btnClearHistory = document.getElementById('btnClearHistory');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    // Header Actions
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    const btnGridToggle = document.getElementById('btnGridToggle');
    const toastContainer = document.getElementById('toastContainer');

    // State
    let isDrawing = false;
    let currentTool = 'pen'; // 'pen' | 'eraser'
    let strokeWidth = parseInt(strokeRange.value, 10);
    let strokeHistory = []; // Array of ImageData snapshots for Undo
    let autoPredictTimer = null;
    let lastResult = null;
    let historyData = [];

    // =========================================================================
    // 1. Canvas Setup & High-DPI Scaling
    // =========================================================================
    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const displayWidth = rect.width || 340;
        const displayHeight = rect.height || 340;

        // Store existing content before resize
        let tempCanvas = null;
        if (canvas.width > 0 && canvas.height > 0) {
            tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            tempCanvas.getContext('2d').drawImage(canvas, 0, 0);
        }

        canvas.width = Math.round(displayWidth * dpr);
        canvas.height = Math.round(displayHeight * dpr);

        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (tempCanvas) {
            ctx.drawImage(tempCanvas, 0, 0, displayWidth, displayHeight);
        } else {
            clearCanvas();
        }
    }

    // Save snapshot for Undo
    function saveSnapshot() {
        if (strokeHistory.length > 20) {
            strokeHistory.shift();
        }
        strokeHistory.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        emptyHint.classList.add('hidden');
    }

    function clearCanvas() {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        strokeHistory = [];
        emptyHint.classList.remove('hidden');

        // Clear mini preview
        miniCtx.fillStyle = '#000000';
        miniCtx.fillRect(0, 0, 28, 28);

        resetResultDisplay();
    }

    function undoStroke() {
        if (strokeHistory.length > 0) {
            strokeHistory.pop(); // Remove current
            if (strokeHistory.length > 0) {
                const prevSnapshot = strokeHistory[strokeHistory.length - 1];
                ctx.putImageData(prevSnapshot, 0, 0);
                emptyHint.classList.add('hidden');
            } else {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
                emptyHint.classList.remove('hidden');
            }
            scheduleAutoPredict();
        }
    }

    // Get pointer coordinates relative to canvas
    function getPointerPos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    // Pointer Event Listeners
    canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        isDrawing = true;
        const pos = getPointerPos(e);

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);

        if (currentTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = strokeWidth * 2;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = strokeWidth;
        }

        // Draw an initial dot
        ctx.lineTo(pos.x + 0.01, pos.y + 0.01);
        ctx.stroke();

        emptyHint.classList.add('hidden');
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!isDrawing) return;
        const pos = getPointerPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    });

    function stopDrawing() {
        if (!isDrawing) return;
        isDrawing = false;
        ctx.closePath();
        saveSnapshot();
        scheduleAutoPredict();
    }

    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);

    // =========================================================================
    // 2. Toolbar & Settings Events
    // =========================================================================
    btnPen.addEventListener('click', () => {
        currentTool = 'pen';
        btnPen.classList.add('active');
        btnEraser.classList.remove('active');
    });

    btnEraser.addEventListener('click', () => {
        currentTool = 'eraser';
        btnEraser.classList.add('active');
        btnPen.classList.remove('active');
    });

    strokeRange.addEventListener('input', (e) => {
        strokeWidth = parseInt(e.target.value, 10);
        strokeDot.style.width = `${strokeWidth}px`;
        strokeDot.style.height = `${strokeWidth}px`;
    });

    btnUndo.addEventListener('click', undoStroke);
    btnClear.addEventListener('click', () => {
        clearCanvas();
        showToast('캔버스가 초기화되었습니다.');
    });

    btnPredict.addEventListener('click', () => {
        runRecognition(true);
    });

    function scheduleAutoPredict() {
        if (!autoPredictToggle.checked) return;
        clearTimeout(autoPredictTimer);
        autoPredictTimer = setTimeout(() => {
            runRecognition(false);
        }, 320); // 320ms debounce after lifting pen
    }

    // =========================================================================
    // 3. AI Prediction Pipeline & Visual Updates
    // =========================================================================
    function runRecognition(isManualClick = false) {
        if (!window.digitEngine) return;

        statusDot.className = 'status-dot processing';
        statusText.textContent = 'AI 분석 중...';

        try {
            // 1. Preprocess
            const prep = window.digitEngine.preprocessCanvas(canvas);

            if (!prep.hasInk) {
                statusDot.className = 'status-dot';
                statusText.textContent = '준비 완료';
                if (isManualClick) {
                    showToast('캔버스에 숫자를 먼저 작성해 주세요.');
                }
                return;
            }

            // Draw preprocessed 28x28 into mini preview
            miniCtx.drawImage(prep.previewCanvas, 0, 0);

            // 2. Predict with Neural Network
            const result = window.digitEngine.predict(prep.inputTensor);
            lastResult = result;

            // 3. Update Result Card (Crucial User Requirement: Result + Accuracy Inline)
            renderResult(result);

            // 4. Record to History if high confidence
            addToHistory(result);

            statusDot.className = 'status-dot';
            statusText.textContent = '인식 완료';
        } catch (err) {
            console.error('[DigitAI] Prediction error:', err);
            statusDot.className = 'status-dot';
            statusText.textContent = '인식 오류';
        }
    }

    /**
     * Renders recognition results with inline accuracy and interactive charts
     */
    function renderResult(result) {
        const { topDigit, confidencePercent, probabilities, top3 } = result;
        const confNum = parseFloat(confidencePercent);

        // Update Big Digit
        largeDigitNumber.textContent = topDigit;
        largeDigitNumber.classList.remove('empty');

        // Update Inline Accuracy Badge right next to Result (User's explicit requirement)
        resultAccuracyBadge.innerHTML = `<span class="badge-icon">✓</span> 정확도 ${confidencePercent}%`;
        resultAccuracyBadge.className = 'accuracy-badge-pill';

        if (confNum >= 85) {
            resultAccuracyBadge.classList.add('high');
            digitStatusText.textContent = `숫자 "${topDigit}"(으)로 판별되었습니다`;
            digitSubtext.textContent = `AI가 ${confidencePercent}%의 높은 신뢰도로 확신합니다.`;
        } else if (confNum >= 60) {
            resultAccuracyBadge.classList.add('mid');
            digitStatusText.textContent = `숫자 "${topDigit}"(으)로 추정됩니다`;
            digitSubtext.textContent = `다소 애매한 필기체입니다 (${confidencePercent}% 확신).`;
        } else {
            resultAccuracyBadge.classList.add('low');
            digitStatusText.textContent = `숫자 "${topDigit}"(으)로 감지됨`;
            digitSubtext.textContent = `확신도가 낮습니다 (${confidencePercent}%). 다시 써보세요.`;
        }

        // Render Top 3 Candidate Chips
        renderTop3(top3);

        // Render 0-9 Probability Distribution Bars
        renderProbabilityBars(probabilities, topDigit);
    }

    function resetResultDisplay() {
        largeDigitNumber.textContent = '-';
        largeDigitNumber.classList.add('empty');

        resultAccuracyBadge.textContent = '대기 중';
        resultAccuracyBadge.className = 'accuracy-badge-pill empty';

        digitStatusText.textContent = '숫자를 필기해 보세요';
        digitSubtext.textContent = '캔버스에 0부터 9까지의 숫자를 그리면 즉시 판별합니다.';

        lastResult = null;

        // Reset Candidates
        candidatesContainer.innerHTML = `
            <div class="candidate-chip"><span class="chip-rank">1위</span><span class="chip-digit">-</span><span class="chip-prob">-</span></div>
            <div class="candidate-chip"><span class="chip-rank">2위</span><span class="chip-digit">-</span><span class="chip-prob">-</span></div>
            <div class="candidate-chip"><span class="chip-rank">3위</span><span class="chip-digit">-</span><span class="chip-prob">-</span></div>
        `;

        // Reset Bars
        buildEmptyProbabilityBars();
    }

    function renderTop3(top3) {
        candidatesContainer.innerHTML = '';
        top3.forEach((item, index) => {
            const chip = document.createElement('div');
            chip.className = `candidate-chip ${index === 0 ? 'rank-1' : ''}`;
            chip.innerHTML = `
                <div>
                    <span class="chip-rank">${index + 1}위</span>
                    <span class="chip-digit">${item.digit}</span>
                </div>
                <span class="chip-prob">${item.percentage}%</span>
            `;
            candidatesContainer.appendChild(chip);
        });
    }

    function buildEmptyProbabilityBars() {
        probBarsContainer.innerHTML = '';
        for (let d = 0; d < 10; d++) {
            const row = document.createElement('div');
            row.className = 'prob-bar-row';
            row.id = `prob-row-${d}`;
            row.innerHTML = `
                <span class="prob-digit-label">${d}</span>
                <div class="prob-bar-track">
                    <div class="prob-bar-fill" id="prob-fill-${d}" style="width: 0%"></div>
                </div>
                <span class="prob-percent-text" id="prob-val-${d}">0.0%</span>
            `;
            probBarsContainer.appendChild(row);
        }
    }

    function renderProbabilityBars(probabilities, topDigit) {
        probabilities.forEach(item => {
            const fill = document.getElementById(`prob-fill-${item.digit}`);
            const val = document.getElementById(`prob-val-${item.digit}`);
            const row = document.getElementById(`prob-row-${item.digit}`);

            if (fill && val && row) {
                fill.style.width = `${Math.min(100, Math.max(0, item.percentage))}%`;
                val.textContent = `${item.percentage}%`;

                if (item.digit === topDigit) {
                    row.classList.add('winner');
                } else {
                    row.classList.remove('winner');
                }
            }
        });
    }

    // =========================================================================
    // 4. Quick Actions: Copy, TTS Voice Read
    // =========================================================================
    btnCopy.addEventListener('click', () => {
        if (!lastResult) {
            showToast('복사할 인식 결과가 없습니다.');
            return;
        }
        navigator.clipboard.writeText(lastResult.topDigit.toString())
            .then(() => {
                showToast(`숫자 "${lastResult.topDigit}" 클립보드에 복사 완료!`);
            })
            .catch(() => {
                showToast('클립보드 접근이 제한되었습니다.');
            });
    });

    btnSpeak.addEventListener('click', () => {
        if (!lastResult) {
            showToast('먼저 숫자를 인식시켜 주세요.');
            return;
        }

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const koreanDigits = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
            const korName = koreanDigits[lastResult.topDigit] || lastResult.topDigit;
            const utter = new SpeechSynthesisUtterance(`숫자 ${korName}, 정확도 ${lastResult.confidencePercent} 퍼센트`);
            utter.lang = 'ko-KR';
            utter.rate = 1.0;
            window.speechSynthesis.speak(utter);
            showToast(`🔊 음성 재생: "숫자 ${korName}"`);
        } else {
            showToast('브라우저에서 음성 합성을 지원하지 않습니다.');
        }
    });

    // =========================================================================
    // 5. History Management
    // =========================================================================
    function addToHistory(result) {
        // Prevent duplicate spamming
        if (historyData.length > 0 && historyData[0].topDigit === result.topDigit && historyData[0].confidencePercent === result.confidencePercent) {
            return;
        }

        const thumbUrl = canvas.toDataURL('image/png');
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

        const item = {
            id: Date.now(),
            digit: result.topDigit,
            confidence: result.confidencePercent,
            time: timeStr,
            thumbnail: thumbUrl
        };

        historyData.unshift(item);
        if (historyData.length > 10) historyData.pop();

        renderHistory();
    }

    function renderHistory() {
        if (historyData.length === 0) {
            historyList.innerHTML = '<div class="history-empty-msg">아직 최근 인식 기록이 없습니다.</div>';
            return;
        }

        historyList.innerHTML = '';
        historyData.forEach(item => {
            const card = document.createElement('div');
            card.className = 'history-item-card';
            card.title = '클릭하여 이 숫자를 캔버스에 복원';

            const confNum = parseFloat(item.confidence);
            let badgeClass = 'high';
            if (confNum < 60) badgeClass = 'low';
            else if (confNum < 85) badgeClass = 'mid';

            card.innerHTML = `
                <img class="history-thumb" src="${item.thumbnail}" alt="손글씨 숫자 ${item.digit}" />
                <div class="history-details">
                    <div class="history-digit-row">
                        <span class="history-digit-val">${item.digit}</span>
                        <span class="history-acc-tag accuracy-badge-pill ${badgeClass}">${item.confidence}%</span>
                    </div>
                    <span class="history-time">${item.time}</span>
                </div>
            `;

            // Click to restore to canvas
            card.addEventListener('click', () => {
                restoreFromHistory(item);
            });

            historyList.appendChild(card);
        });
    }

    function restoreFromHistory(item) {
        const img = new Image();
        img.onload = () => {
            clearCanvas();
            ctx.drawImage(img, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
            saveSnapshot();
            runRecognition(false);
            showToast(`숫자 "${item.digit}" 필기를 복원했습니다.`);
        };
        img.src = item.thumbnail;
    }

    btnClearHistory.addEventListener('click', () => {
        historyData = [];
        renderHistory();
        showToast('최근 작업 기록이 삭제되었습니다.');
    });

    // =========================================================================
    // 6. Theme Toggle & Grid Overlay
    // =========================================================================
    btnGridToggle.addEventListener('click', () => {
        const isVisible = gridOverlay.classList.toggle('visible');
        btnGridToggle.classList.toggle('active', isVisible);
        showToast(isVisible ? '가이드 격자가 켜졌습니다.' : '가이드 격자가 꺼졌습니다.');
    });

    function initTheme() {
        const metaTheme = document.querySelector('meta[name="color-scheme"]');
        const saved = localStorage.getItem('color-scheme');
        if (saved) {
            metaTheme.content = saved;
        }
        updateThemeButton();
    }

    function updateThemeButton() {
        const metaTheme = document.querySelector('meta[name="color-scheme"]');
        const isDark = metaTheme.content === 'dark' || 
            (metaTheme.content === 'light dark' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        btnThemeToggle.textContent = isDark ? '☀️' : '🌙';
        btnThemeToggle.title = isDark ? '라이트 모드로 전환' : '다크 모드로 전환';
    }

    btnThemeToggle.addEventListener('click', () => {
        const metaTheme = document.querySelector('meta[name="color-scheme"]');
        const isCurrentlyDark = metaTheme.content === 'dark' || 
            (metaTheme.content === 'light dark' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const nextScheme = isCurrentlyDark ? 'light' : 'dark';

        metaTheme.content = nextScheme;
        localStorage.setItem('color-scheme', nextScheme);
        updateThemeButton();
        showToast(nextScheme === 'dark' ? '다크 모드로 변경되었습니다.' : '라이트 모드로 변경되었습니다.');
    });

    // =========================================================================
    // 7. Toast Notification Utility
    // =========================================================================
    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toastContainer.appendChild(toast);

        // Force reflow
        void toast.offsetWidth;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 2200);
    }

    // =========================================================================
    // Initialize
    // =========================================================================
    initTheme();
    resizeCanvas();
    buildEmptyProbabilityBars();
    window.addEventListener('resize', resizeCanvas);

    // Initial stroke dot size
    strokeDot.style.width = `${strokeWidth}px`;
    strokeDot.style.height = `${strokeWidth}px`;

    console.log('[DigitAI] App initialized successfully.');
});
