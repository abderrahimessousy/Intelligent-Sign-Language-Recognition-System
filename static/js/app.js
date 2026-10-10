class ASLNexusPro {
    constructor() {
        this.api = {
            lastJson: '/last_json',
            lastImage: '/last',
            manualAdd: '/manual_add',
            manualDelete: '/manual_delete',
            manualSpace: '/manual_space',
            manualClear: '/manual_clear',
            manualSpeak: '/manual_speak',
            manualSpeakSentence: '/manual_speak_sentence',
            manualClearSentence: '/manual_clear_sentence',
            setVolume: '/set_volume',
            wordHistory: '/word_history.json',
            ping: '/ping'
        };
        
        this.state = {
            connected: true,
            lastResult: null,
            manualWord: [],
            manualSentence: [],
            wordHistory: [],
            recentLetters: [],
            volume: 80,
            lastSpokenWord: '',
            cooldown: 0.6,
            lastConfirmedAt: 0,
            minConfidence: 0.60,
            numClasses: 29,
            pollingInterval: null,
            cameraInterval: null,
            historyInterval: null,
            pingInterval: null,
            theme: localStorage.getItem('theme') || 'dark',
            fps: 0,
            frameCount: 0,
            lastFrameTime: performance.now(),
            systemLoad: 0
        };
        
        this.elements = {};
        this.init();
    }

    init() {
        this.cacheElements();
        this.attachEventListeners();
        this.startPolling();
        this.loadInitialData();
        this.hideLoading();
        this.initParticles();
        this.initTheme();
        this.startPerformanceMonitoring();
        this.addHighTechEffects();
    }

    cacheElements() {
        this.elements = {
            loadingOverlay: document.getElementById('loadingOverlay'),
            cameraFeed: document.getElementById('cameraFeed'),
            connectionStatus: document.getElementById('connectionStatus'),
            handStatus: document.getElementById('handStatus'),
            lastUpdate: document.getElementById('lastUpdate'),
            imageSize: document.getElementById('imageSize'),
            currentLetter: document.getElementById('currentLetter'),
            confidenceValue: document.getElementById('confidenceValue'),
            confidenceFill: document.getElementById('confidenceFill'),
            classId: document.getElementById('classId'),
            detectionTime: document.getElementById('detectionTime'),
            bboxStatus: document.getElementById('bboxStatus'),
            detectionRing: document.getElementById('detectionRing'),
            bboxOverlay: document.getElementById('bboxOverlay'),
            recentLetters: document.getElementById('recentLetters'),
            currentWord: document.getElementById('currentWord'),
            wordCount: document.getElementById('wordCount'),
            wordProgress: document.getElementById('wordProgress'),
            sentenceDisplay: document.getElementById('sentenceDisplay'),
            historyList: document.getElementById('historyList'),
            historyCount: document.getElementById('historyCount'),
            lastSpoken: document.getElementById('lastSpoken'),
            statusMessage: document.getElementById('statusMessage'),
            tipMessage: document.getElementById('tipMessage'),
            serverTime: document.getElementById('serverTime'),
            numClasses: document.getElementById('numClasses'),
            configCooldown: document.getElementById('configCooldown'),
            configMinConfidence: document.getElementById('configMinConfidence'),
            volumeSlider: document.getElementById('volumeSlider'),
            refreshBtn: document.getElementById('refreshBtn'),
            infoBtn: document.getElementById('infoBtn'),
            btnAdd: document.getElementById('btnAdd'),
            btnDelete: document.getElementById('btnDelete'),
            btnSpace: document.getElementById('btnSpace'),
            btnClear: document.getElementById('btnClear'),
            btnSpeak: document.getElementById('btnSpeak'),
            btnSpeakSentence: document.getElementById('btnSpeakSentence'),
            btnClearSentence: document.getElementById('btnClearSentence'),
            modeBadge: document.getElementById('modeBadge'),
            cooldownIndicator: document.getElementById('cooldownIndicator'),
            cooldownTimer: document.getElementById('cooldownTimer'),
            systemInfo: document.getElementById('systemInfo'),
            themeToggle: document.getElementById('themeToggle'),
            volumeControl: document.querySelector('.volume-control')
        };
    }

    attachEventListeners() {
        // Volume control
        this.elements.volumeSlider?.addEventListener('input', (e) => {
            const value = e.target.value;
            this.state.volume = value;
            this.setVolume(value);
            this.showVolumeFeedback(value);
        });

        // Refresh button
        this.elements.refreshBtn?.addEventListener('click', () => {
            this.refreshCamera();
            this.animateButton(this.elements.refreshBtn);
            this.showNotification('Camera feed refreshed', 'info');
            this.addRippleEffect(this.elements.refreshBtn);
        });

        // Info button
        this.elements.infoBtn?.addEventListener('click', () => {
            this.toggleSystemInfo();
            this.animateButton(this.elements.infoBtn);
            this.addRippleEffect(this.elements.infoBtn);
        });

        // Theme toggle
        this.elements.themeToggle?.addEventListener('click', () => {
            this.toggleTheme();
            this.animateButton(this.elements.themeToggle);
            this.addRippleEffect(this.elements.themeToggle);
        });

        // Manual controls with animations
        this.elements.btnAdd?.addEventListener('click', () => {
            this.manualAdd();
            this.animateButton(this.elements.btnAdd);
            this.addRippleEffect(this.elements.btnAdd);
        });
        
        this.elements.btnDelete?.addEventListener('click', () => {
            this.manualDelete();
            this.animateButton(this.elements.btnDelete);
            this.addRippleEffect(this.elements.btnDelete);
        });
        
        this.elements.btnSpace?.addEventListener('click', () => {
            this.manualSpace();
            this.animateButton(this.elements.btnSpace);
            this.addRippleEffect(this.elements.btnSpace);
        });
        
        this.elements.btnClear?.addEventListener('click', () => {
            this.manualClear();
            this.animateButton(this.elements.btnClear);
            this.addRippleEffect(this.elements.btnClear);
        });
        
        this.elements.btnSpeak?.addEventListener('click', () => {
            this.manualSpeak();
            this.animateButton(this.elements.btnSpeak);
            this.addRippleEffect(this.elements.btnSpeak);
        });
        
        this.elements.btnSpeakSentence?.addEventListener('click', () => {
            this.manualSpeakSentence();
            this.animateButton(this.elements.btnSpeakSentence);
            this.addRippleEffect(this.elements.btnSpeakSentence);
        });
        
        this.elements.btnClearSentence?.addEventListener('click', () => {
            this.manualClearSentence();
            this.animateButton(this.elements.btnClearSentence);
            this.addRippleEffect(this.elements.btnClearSentence);
        });

        // Camera error handling
        this.elements.cameraFeed?.addEventListener('error', () => {
            setTimeout(() => this.refreshCamera(), 2000);
        });

        // Camera load success
        this.elements.cameraFeed?.addEventListener('load', () => {
            this.state.frameCount++;
        });

        // Window resize handler
        window.addEventListener('resize', this.debounce(() => {
            if (this.state.lastResult?.bbox) {
                this.updateBBoxOverlay(this.state.lastResult.bbox);
            }
        }, 250));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Alt+A for Add
            if (e.altKey && e.key === 'a') {
                e.preventDefault();
                this.manualAdd();
                this.animateButton(this.elements.btnAdd);
                this.addRippleEffect(this.elements.btnAdd);
            }
            // Alt+D for Delete
            if (e.altKey && e.key === 'd') {
                e.preventDefault();
                this.manualDelete();
                this.animateButton(this.elements.btnDelete);
                this.addRippleEffect(this.elements.btnDelete);
            }
            // Alt+S for Space
            if (e.altKey && e.key === 's') {
                e.preventDefault();
                this.manualSpace();
                this.animateButton(this.elements.btnSpace);
                this.addRippleEffect(this.elements.btnSpace);
            }
            // Alt+C for Clear
            if (e.altKey && e.key === 'c') {
                e.preventDefault();
                this.manualClear();
                this.animateButton(this.elements.btnClear);
                this.addRippleEffect(this.elements.btnClear);
            }
        });
    }

    initTheme() {
        document.body.setAttribute('data-theme', this.state.theme);
        localStorage.setItem('theme', this.state.theme);
    }

    toggleTheme() {
        this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', this.state.theme);
        localStorage.setItem('theme', this.state.theme);
        
        // Trigger high-tech particles on theme change
        this.createTechParticles();
        
        this.showNotification(`Switched to ${this.state.theme} mode`, 'info');
    }

    createTechParticles() {
        const colors = this.state.theme === 'dark' ? ['#ffffff', '#cccccc', '#999999'] : ['#000000', '#333333', '#666666'];
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                const particle = document.createElement('div');
                particle.className = 'tech-particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.top = Math.random() * 100 + '%';
                particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                particle.style.width = (2 + Math.random() * 4) + 'px';
                particle.style.height = particle.style.width;
                particle.style.animation = `techParticleFloat ${3 + Math.random() * 3}s linear forwards`;
                document.body.appendChild(particle);
                
                setTimeout(() => particle.remove(), 5000);
            }, i * 30);
        }
    }

    addRippleEffect(element) {
        const ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        element.appendChild(ripple);
        
        setTimeout(() => {
            ripple.remove();
        }, 1000);
    }

    startPerformanceMonitoring() {
        setInterval(() => {
            const now = performance.now();
            const delta = now - this.state.lastFrameTime;
            this.state.fps = Math.round(1000 / delta);
            this.state.lastFrameTime = now;
            
            // Update server time with FPS info for high-tech feel
            if (this.elements.serverTime) {
                this.elements.serverTime.textContent = `FPS: ${this.state.fps} | ${new Date().toLocaleTimeString()}`;
            }
        }, 1000);
    }

    addHighTechEffects() {
        // Add scan line effect to cards
        document.querySelectorAll('.card').forEach(card => {
            const scanLine = document.createElement('div');
            scanLine.className = 'card-scan-line';
            card.appendChild(scanLine);
        });

        // Add glitch effect to logo on hover
        const logoContainer = document.querySelector('.logo-image-container');
        if (logoContainer) {
            logoContainer.addEventListener('mouseenter', () => {
                this.addGlitchEffect(logoContainer);
            });
        }
    }

    addGlitchEffect(element) {
        element.style.animation = 'glitch 0.3s ease-in-out';
        setTimeout(() => {
            element.style.animation = '';
        }, 300);
    }

    animateButton(button) {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = '';
        }, 200);
    }

    showVolumeFeedback(value) {
        const volumeIcon = this.elements.volumeControl?.querySelector('i');
        if (volumeIcon) {
            if (value == 0) {
                volumeIcon.className = 'fas fa-volume-mute';
            } else if (value < 50) {
                volumeIcon.className = 'fas fa-volume-down';
            } else {
                volumeIcon.className = 'fas fa-volume-up';
            }
        }
    }

    toggleSystemInfo() {
        if (this.elements.systemInfo) {
            if (this.elements.systemInfo.style.display === 'none' || 
                this.elements.systemInfo.style.display === '') {
                this.elements.systemInfo.style.display = 'block';
                this.elements.systemInfo.style.animation = 'slideDown 0.3s ease-out';
            } else {
                this.elements.systemInfo.style.animation = 'slideUp 0.3s ease-out';
                setTimeout(() => {
                    this.elements.systemInfo.style.display = 'none';
                }, 300);
            }
        }
    }

    initParticles() {
        const particles = document.getElementById('particles');
        if (!particles) return;

        for (let i = 0; i < 100; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.top = Math.random() * 100 + '%';
            particle.style.animationDuration = 10 + Math.random() * 20 + 's';
            particle.style.animationDelay = Math.random() * 5 + 's';
            particle.style.opacity = 0.1 + Math.random() * 0.3;
            particles.appendChild(particle);
        }
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    startPolling() {
        // Poll for last result every second
        this.state.pollingInterval = setInterval(() => this.fetchLastResult(), 1000);
        
        // Refresh camera every 2 seconds
        this.state.cameraInterval = setInterval(() => this.refreshCamera(), 2000);
        
        // Load word history every 10 seconds
        this.state.historyInterval = setInterval(() => this.loadWordHistory(), 10000);
        
        // Ping server every 30 seconds
        this.state.pingInterval = setInterval(() => this.pingServer(), 30000);
    }

    hideLoading() {
        setTimeout(() => {
            if (this.elements.loadingOverlay) {
                this.elements.loadingOverlay.classList.add('hidden');
            }
        }, 1500);
    }

    async fetchLastResult() {
        try {
            const response = await fetch(this.api.lastJson);
            if (!response.ok) throw new Error('Network error');
            
            const data = await response.json();
            this.state.lastResult = data;
            this.updateUI(data);
            this.updateConnectionStatus(true);
            
            // Update config values
            if (data.cooldown) {
                this.state.cooldown = data.cooldown;
                if (this.elements.configCooldown) {
                    this.elements.configCooldown.textContent = `${data.cooldown}s`;
                }
            }
            
            if (data.min_confidence) {
                this.state.minConfidence = data.min_confidence;
                if (this.elements.configMinConfidence) {
                    this.elements.configMinConfidence.textContent = `${Math.round(data.min_confidence * 100)}%`;
                }
            }
            
            if (data.num_classes && this.elements.numClasses) {
                this.elements.numClasses.textContent = data.num_classes;
            }
            
        } catch (error) {
            console.error('Failed to fetch last result:', error);
            this.updateConnectionStatus(false);
        }
    }

    updateUI(data) {
        // Update detection
        if (data.ok && data.predicted_letter) {
            this.elements.currentLetter.textContent = data.predicted_letter;
            this.elements.handStatus.textContent = 'Hand detected';
            this.elements.detectionRing?.classList.add('active');
            
            // Update confidence with color coding
            const confidence = Math.round(data.confidence * 100);
            this.elements.confidenceValue.textContent = `${confidence}%`;
            this.elements.confidenceFill.style.width = `${confidence}%`;
            
            // Remove existing color classes
            this.elements.confidenceFill.classList.remove('low', 'medium', 'high');
            
            // Add color class based on confidence
            if (confidence < 60) {
                this.elements.confidenceFill.classList.add('low');
            } else if (confidence < 80) {
                this.elements.confidenceFill.classList.add('medium');
            } else {
                this.elements.confidenceFill.classList.add('high');
            }
            
            // Update class ID
            this.elements.classId.textContent = data.predicted_class_id ?? '-';
            
            // Update detection time
            if (data.ts) {
                const time = new Date(data.ts).toLocaleTimeString();
                this.elements.detectionTime.textContent = time;
            }
            
            // Update bbox status and overlay
            if (data.bbox) {
                this.elements.bboxStatus.textContent = 'BBox detected';
                this.updateBBoxOverlay(data.bbox);
            } else {
                this.elements.bboxStatus.textContent = 'No bbox';
                this.elements.bboxOverlay.classList.remove('active');
            }
            
            // Update image size
            if (data.bytes) {
                const size = (data.bytes / 1024).toFixed(1);
                this.elements.imageSize.textContent = `${size} KB`;
            }
            
            // Add to recent letters (if new)
            this.addToRecentLetters(data.predicted_letter);
            
            // Update status message
            this.elements.statusMessage.textContent = `Detected: ${data.predicted_letter} (${confidence}% confidence)`;
            
            // Enable/disable add button based on confidence
            if (this.elements.btnAdd) {
                if (confidence < 60) {
                    this.elements.btnAdd.disabled = true;
                    this.elements.btnAdd.title = 'Confidence too low (min 60%)';
                } else {
                    this.elements.btnAdd.disabled = false;
                    this.elements.btnAdd.title = 'Add detected letter to word';
                }
            }
        } else {
            this.elements.currentLetter.textContent = '✋';
            this.elements.handStatus.textContent = data.reason === 'no_hand' ? 'No hand detected' : 'Waiting for hand...';
            this.elements.detectionRing?.classList.remove('active');
            this.elements.bboxOverlay.classList.remove('active');
            this.elements.confidenceValue.textContent = '0%';
            this.elements.confidenceFill.style.width = '0%';
            this.elements.confidenceFill.classList.remove('low', 'medium', 'high');
            this.elements.bboxStatus.textContent = 'No detection';
            this.elements.statusMessage.textContent = data.reason || 'Waiting for hand...';
            
            // Disable add button when no detection
            if (this.elements.btnAdd) {
                this.elements.btnAdd.disabled = true;
            }
        }
        
        // Update manual word
        if (data.manual_word !== undefined) {
            this.state.manualWord = data.manual_word || '';
            this.updateWordDisplay(data.manual_word || '');
        }
        
        // Update sentence
        if (data.manual_sentence !== undefined) {
            this.state.manualSentence = data.manual_sentence || '';
            this.updateSentenceDisplay(data.manual_sentence || '');
        }
        
        // Update last spoken word
        if (data.last_spoken_word) {
            this.state.lastSpokenWord = data.last_spoken_word;
            this.updateLastSpoken(data.last_spoken_word);
        }
    }

    updateBBoxOverlay(bbox) {
        if (!bbox || !this.elements.bboxOverlay || !this.elements.cameraFeed) return;
        
        const [x1, y1, x2, y2] = bbox;
        const container = this.elements.cameraFeed.parentElement;
        const containerRect = container.getBoundingClientRect();
        
        // Calculate relative position
        const scaleX = containerRect.width / 640;
        const scaleY = containerRect.height / 480;
        
        const left = Math.max(0, Math.min(containerRect.width, x1 * scaleX));
        const top = Math.max(0, Math.min(containerRect.height, y1 * scaleY));
        const width = Math.min(containerRect.width - left, (x2 - x1) * scaleX);
        const height = Math.min(containerRect.height - top, (y2 - y1) * scaleY);
        
        this.elements.bboxOverlay.style.left = `${left}px`;
        this.elements.bboxOverlay.style.top = `${top}px`;
        this.elements.bboxOverlay.style.width = `${width}px`;
        this.elements.bboxOverlay.style.height = `${height}px`;
        this.elements.bboxOverlay.classList.add('active');
    }

    updateConnectionStatus(connected) {
        if (!this.elements.connectionStatus) return;
        
        const dot = this.elements.connectionStatus.querySelector('.status-dot');
        const text = this.elements.connectionStatus.querySelector('.status-text');
        
        if (connected !== this.state.connected) {
            this.state.connected = connected;
            
            if (connected) {
                dot.className = 'status-dot connected';
                text.textContent = 'Connected';
                this.elements.statusMessage.textContent = 'System connected';
            } else {
                dot.className = 'status-dot disconnected';
                text.textContent = 'Disconnected';
                this.elements.statusMessage.textContent = 'Connection lost - retrying...';
                this.showNotification('Connection lost. Reconnecting...', 'error');
            }
        }
    }

    addToRecentLetters(letter) {
        if (!letter || letter.length !== 1) return;
        
        // Avoid duplicates in a row
        if (this.state.recentLetters[0] === letter) return;
        
        this.state.recentLetters.unshift(letter);
        if (this.state.recentLetters.length > 8) {
            this.state.recentLetters.pop();
        }
        
        if (this.elements.recentLetters) {
            this.elements.recentLetters.innerHTML = this.state.recentLetters
                .map(l => `<span class="recent-letter" style="animation: letterPop 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);">${l}</span>`)
                .join('');
        }
    }

    updateWordDisplay(word) {
        if (!this.elements.currentWord) return;
        
        if (word && word.length > 0) {
            const letters = word.split('');
            this.elements.currentWord.innerHTML = letters
                .map((l, i) => `<span style="animation: letterPop 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) ${i * 0.1}s;">${l}</span>`)
                .join('');
            this.elements.wordCount.textContent = `${word.length} letters`;
            
            // Update progress (max 10 letters for full bar)
            const progress = Math.min(100, (word.length / 10) * 100);
            this.elements.wordProgress.style.width = `${progress}%`;
        } else {
            this.elements.currentWord.innerHTML = '<span class="placeholder">No letters yet</span>';
            this.elements.wordCount.textContent = '0 letters';
            this.elements.wordProgress.style.width = '0%';
        }
    }

    updateSentenceDisplay(sentence) {
        if (!this.elements.sentenceDisplay) return;
        
        if (sentence && sentence.length > 0) {
            this.elements.sentenceDisplay.innerHTML = sentence;
            this.elements.sentenceDisplay.style.animation = 'fadeIn 0.5s ease-out';
        } else {
            this.elements.sentenceDisplay.innerHTML = '<span class="placeholder">No sentence yet</span>';
        }
    }

    updateLastSpoken(word) {
        if (!this.elements.lastSpoken) return;
        
        if (word) {
            this.elements.lastSpoken.innerHTML = word;
            this.elements.lastSpoken.style.animation = 'pulse 0.5s ease-out';
        } else {
            this.elements.lastSpoken.innerHTML = '<span class="placeholder">No words spoken yet</span>';
        }
    }

    refreshCamera() {
        if (this.elements.cameraFeed) {
            this.elements.cameraFeed.src = `${this.api.lastImage}?t=${Date.now()}`;
            this.elements.lastUpdate.textContent = new Date().toLocaleTimeString();
            this.elements.cameraFeed.style.animation = 'fadeIn 0.3s ease-out';
        }
    }

    async manualAdd() {
        try {
            const now = Date.now() / 1000;
            if (now - this.state.lastConfirmedAt < this.state.cooldown) {
                const remaining = (this.state.cooldown - (now - this.state.lastConfirmedAt)).toFixed(1);
                this.showCooldown(remaining);
                this.showNotification(`Please wait ${remaining}s before adding another letter`, 'warning');
                return;
            }

            const response = await fetch(this.api.manualAdd);
            const data = await response.json();
            
            if (data.success) {
                this.state.lastConfirmedAt = Date.now() / 1000;
                this.showNotification(`Added letter: ${data.letter}`, 'success');
                this.startCooldownTimer();
                await this.fetchLastResult();
                
                // Trigger success animation
                this.elements.currentWord.style.animation = 'pulse 0.5s ease-out';
                this.createTechParticles();
            } else {
                let message = data.error || 'Failed to add letter';
                if (data.error === 'low_confidence') {
                    message = `Confidence too low (${Math.round(data.confidence * 100)}% - need 60%)`;
                } else if (data.error === 'cooldown') {
                    message = 'Please wait before adding another letter';
                } else if (data.error === 'no_letter_detected') {
                    message = 'No letter detected';
                } else if (data.error && data.error.includes('invalid_label')) {
                    message = 'Cannot add special characters (del, space, nothing)';
                }
                this.showNotification(message, 'warning');
            }
        } catch (error) {
            this.showNotification('Network error', 'error');
        }
    }

    async manualDelete() {
        try {
            const response = await fetch(this.api.manualDelete);
            const data = await response.json();
            
            if (data.success) {
                this.showNotification('Letter deleted', 'info');
                this.state.recentLetters.shift();
                if (this.elements.recentLetters) {
                    this.elements.recentLetters.innerHTML = this.state.recentLetters
                        .map(l => `<span class="recent-letter">${l}</span>`)
                        .join('');
                }
                await this.fetchLastResult();
                
                // Trigger delete animation
                this.elements.currentWord.style.animation = 'shake 0.5s ease-out';
            } else {
                this.showNotification('No letter to delete', 'warning');
            }
        } catch (error) {
            this.showNotification('Network error', 'error');
        }
    }

    async manualSpace() {
        try {
            const response = await fetch(this.api.manualSpace);
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`Word completed: ${data.word}`, 'success');
                this.state.recentLetters = [];
                if (this.elements.recentLetters) {
                    this.elements.recentLetters.innerHTML = '';
                }
                await this.fetchLastResult();
                this.loadWordHistory();
                
                // Trigger success animation
                this.createTechParticles();
            } else {
                this.showNotification('No word to complete', 'warning');
            }
        } catch (error) {
            this.showNotification('Network error', 'error');
        }
    }

    async manualClear() {
        try {
            await fetch(this.api.manualClear);
            this.showNotification('Word cleared', 'info');
            this.state.recentLetters = [];
            if (this.elements.recentLetters) {
                this.elements.recentLetters.innerHTML = '';
            }
            await this.fetchLastResult();
            
            // Trigger clear animation
            this.elements.currentWord.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                this.elements.currentWord.style.animation = '';
            }, 300);
        } catch (error) {
            this.showNotification('Network error', 'error');
        }
    }

    async manualSpeak() {
        try {
            const response = await fetch(this.api.manualSpeak);
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`Speaking: ${data.word}`, 'success');
                await this.fetchLastResult();
                
                // Trigger speaking animation
                this.elements.lastSpoken.style.animation = 'pulse 1s ease-out infinite';
                setTimeout(() => {
                    this.elements.lastSpoken.style.animation = '';
                }, 2000);
                
                // Create audio visualization effect
                this.createAudioVisualization();
            } else {
                this.showNotification('No word to speak', 'warning');
            }
        } catch (error) {
            this.showNotification('Network error', 'error');
        }
    }

    createAudioVisualization() {
        const bars = 20;
        const container = document.createElement('div');
        container.className = 'audio-visualization';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 4px;
            z-index: 9999;
            pointer-events: none;
        `;
        
        for (let i = 0; i < bars; i++) {
            const bar = document.createElement('div');
            bar.style.cssText = `
                width: 4px;
                height: ${20 + Math.random() * 30}px;
                background: var(--primary);
                animation: audioBar ${0.2 + Math.random() * 0.3}s ease-in-out infinite;
                opacity: 0.8;
            `;
            container.appendChild(bar);
        }
        
        document.body.appendChild(container);
        
        setTimeout(() => {
            container.remove();
        }, 2000);
    }

    async manualSpeakSentence() {
        try {
            const response = await fetch(this.api.manualSpeakSentence);
            const data = await response.json();
            
            if (data.success) {
                this.showNotification('Speaking sentence...', 'success');
                
                // Trigger speaking animation
                this.elements.sentenceDisplay.style.animation = 'pulse 1s ease-out infinite';
                setTimeout(() => {
                    this.elements.sentenceDisplay.style.animation = '';
                }, 2000);
                
                // Create audio visualization
                this.createAudioVisualization();
            } else {
                this.showNotification('No sentence to speak', 'warning');
            }
        } catch (error) {
            this.showNotification('Network error', 'error');
        }
    }

    async manualClearSentence() {
        try {
            await fetch(this.api.manualClearSentence);
            this.showNotification('Sentence cleared', 'info');
            await this.fetchLastResult();
            
            // Trigger clear animation
            this.elements.sentenceDisplay.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                this.elements.sentenceDisplay.style.animation = '';
            }, 300);
        } catch (error) {
            this.showNotification('Network error', 'error');
        }
    }

    async setVolume(value) {
        try {
            await fetch(`${this.api.setVolume}?volume=${value}`);
        } catch (error) {
            console.error('Failed to set volume:', error);
        }
    }

    async loadWordHistory() {
        try {
            const response = await fetch(this.api.wordHistory);
            if (!response.ok) return;
            
            const data = await response.json();
            this.state.wordHistory = data;
            this.updateHistoryDisplay(data);
        } catch (error) {
            console.error('Failed to load word history:', error);
        }
    }

    updateHistoryDisplay(history) {
        if (!this.elements.historyList) return;
        
        if (history && history.length > 0) {
            this.elements.historyList.innerHTML = history.map((item, index) => `
                <div class="history-item" style="animation: slideIn 0.5s ease-out ${index * 0.1}s;">
                    <span class="history-word">${item.word}</span>
                    <span class="history-time">${this.formatTime(item.timestamp)}</span>
                </div>
            `).join('');
            
            if (this.elements.historyCount) {
                this.elements.historyCount.textContent = history.length;
            }
        } else {
            this.elements.historyList.innerHTML = '<div class="history-item" style="animation: fadeIn 0.5s ease-out;">No history yet</div>';
            if (this.elements.historyCount) {
                this.elements.historyCount.textContent = '0';
            }
        }
    }

    formatTime(timestamp) {
        if (!timestamp) return '';
        
        const date = new Date(timestamp);
        const now = new Date();
        const diff = Math.floor((now - date) / 60000); // minutes
        
        if (diff < 1) return 'Just now';
        if (diff < 60) return `${diff} min ago`;
        if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
        return date.toLocaleDateString();
    }

    async pingServer() {
        try {
            const response = await fetch(this.api.ping);
            const data = await response.json();
            
            if (this.elements.serverTime) {
                this.elements.serverTime.textContent = `FPS: ${this.state.fps} | ${data.time || new Date().toLocaleTimeString()}`;
            }
        } catch (error) {
            console.error('Ping failed:', error);
        }
    }

    showCooldown(seconds) {
        if (this.elements.cooldownIndicator && this.elements.cooldownTimer) {
            this.elements.cooldownIndicator.style.display = 'flex';
            this.elements.cooldownIndicator.style.animation = 'fadeIn 0.3s ease-out';
            this.elements.cooldownTimer.textContent = `${seconds}s`;
            
            setTimeout(() => {
                this.elements.cooldownIndicator.style.animation = 'fadeOut 0.3s ease-out';
                setTimeout(() => {
                    this.elements.cooldownIndicator.style.display = 'none';
                }, 300);
            }, 3000);
        }
    }

    startCooldownTimer() {
        if (this.elements.cooldownIndicator && this.elements.cooldownTimer) {
            this.elements.cooldownIndicator.style.display = 'flex';
            this.elements.cooldownIndicator.style.animation = 'fadeIn 0.3s ease-out';
            
            let remaining = this.state.cooldown;
            const interval = setInterval(() => {
                remaining -= 0.1;
                if (remaining <= 0) {
                    clearInterval(interval);
                    this.elements.cooldownIndicator.style.animation = 'fadeOut 0.3s ease-out';
                    setTimeout(() => {
                        this.elements.cooldownIndicator.style.display = 'none';
                    }, 300);
                } else {
                    this.elements.cooldownTimer.textContent = `${remaining.toFixed(1)}s`;
                }
            }, 100);
        }
    }

    async loadInitialData() {
        await this.fetchLastResult();
        await this.loadWordHistory();
        await this.pingServer();
        this.setVolume(this.state.volume);
        this.updateTips();
    }

    updateTips() {
        const tips = [
            'Click "Add Letter" to add detected letter to your word',
            'Green detection ring means high confidence (80%+)',
            'Use "Finish Word" to add spaces between words',
            'Volume slider controls TTS output',
            'Minimum confidence required: 60%',
            'Cooldown between adds: 0.6 seconds',
            'Special characters (del, space) cannot be added manually',
            'Click refresh button if camera feed freezes',
            'Info button shows system configuration',
            'Toggle theme for dark/light mode',
            'Use Alt+A to add, Alt+D to delete, Alt+S to finish word, Alt+C to clear',
            'The letter glow changes color based on confidence',
            'Hover over buttons for tooltips',
            'Notifications appear in the top-right corner',
            'Black & white theme for high-tech aesthetics',
            'Your custom logo adds personal touch'
        ];
        
        let tipIndex = 0;
        setInterval(() => {
            tipIndex = (tipIndex + 1) % tips.length;
            if (this.elements.tipMessage) {
                this.elements.tipMessage.style.animation = 'fadeOut 0.3s ease-out';
                setTimeout(() => {
                    if (this.elements.tipMessage) {
                        this.elements.tipMessage.textContent = tips[tipIndex];
                        this.elements.tipMessage.style.animation = 'fadeIn 0.3s ease-out';
                    }
                }, 300);
            }
        }, 6000);
    }

    showNotification(message, type = 'info', duration = 3000) {
        const container = document.getElementById('notificationContainer');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icon = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        }[type] || 'info-circle';
        
        notification.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        `;

        container.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
            setTimeout(() => notification.remove(), 500);
        }, duration);
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    window.aslNexusPro = new ASLNexusPro();
});

// Add CSS for high-tech animations
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
        20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
    
    @keyframes fadeOut {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(0.9); }
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1); }
    }
    
    .particle {
        position: absolute;
        width: 2px;
        height: 2px;
        background: var(--primary);
        border-radius: 50%;
        pointer-events: none;
        opacity: 0.2;
        animation: particleFloat linear infinite;
    }
    
    @keyframes particleFloat {
        0% { transform: translateY(0) translateX(0); }
        100% { transform: translateY(-100vh) translateX(100vw); }
    }
    
    @keyframes techParticleFloat {
        0% { transform: translate(0, 0) scale(1); opacity: 1; }
        100% { transform: translate(calc(100vw * ${Math.random() > 0.5 ? 1 : -1}), -100vh) scale(0); opacity: 0; }
    }
    
    .tech-particle {
        position: fixed;
        width: 4px;
        height: 4px;
        background: var(--primary);
        border-radius: 50%;
        pointer-events: none;
        z-index: 9999;
        box-shadow: 0 0 10px var(--primary);
    }
    
    .card-scan-line {
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 2px;
        background: linear-gradient(90deg, transparent, var(--primary), transparent);
        animation: cardScan 3s linear infinite;
        opacity: 0.3;
        pointer-events: none;
    }
    
    @keyframes cardScan {
        0% { left: -100%; }
        50% { left: 100%; }
        100% { left: 100%; }
    }
    
    @keyframes glitch {
        0% { transform: translate(0); filter: hue-rotate(0deg); }
        20% { transform: translate(-2px, 2px); filter: hue-rotate(90deg); }
        40% { transform: translate(2px, -2px); filter: hue-rotate(180deg); }
        60% { transform: translate(-2px, -2px); filter: hue-rotate(270deg); }
        80% { transform: translate(2px, 2px); filter: hue-rotate(360deg); }
        100% { transform: translate(0); filter: hue-rotate(0deg); }
    }
    
    .ripple-effect {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 0;
        height: 0;
        background: radial-gradient(circle, var(--primary) 0%, transparent 70%);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        animation: rippleExpand 1s ease-out;
        pointer-events: none;
        z-index: 10;
    }
    
    @keyframes rippleExpand {
        0% { width: 0; height: 0; opacity: 0.8; }
        100% { width: 200px; height: 200px; opacity: 0; }
    }
    
    @keyframes audioBar {
        0%, 100% { height: 20px; opacity: 0.5; }
        50% { height: 50px; opacity: 1; }
    }
    
    /* High-tech glow for buttons */
    .btn::after {
        content: '';
        position: absolute;
        top: -2px;
        left: -2px;
        right: -2px;
        bottom: -2px;
        background: linear-gradient(45deg, var(--primary), transparent, var(--primary));
        border-radius: inherit;
        z-index: -1;
        opacity: 0;
        transition: opacity 0.3s ease;
    }
    
    .btn:hover::after {
        opacity: 0.5;
        animation: borderRotate 2s linear infinite;
    }
    
    @keyframes borderRotate {
        0% { filter: hue-rotate(0deg); }
        100% { filter: hue-rotate(360deg); }
    }
    
    /* Logo hover effect */
    .logo-image-container {
        position: relative;
        overflow: hidden;
    }
    
    .logo-image-container::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.1), transparent);
        transform: rotate(45deg);
        animation: logoShine 3s ease-in-out infinite;
        opacity: 0;
        transition: opacity 0.3s ease;
    }
    
    .logo-image-container:hover::after {
        opacity: 1;
    }
    
    @keyframes logoShine {
        0% { transform: translateX(-100%) rotate(45deg); }
        20%, 100% { transform: translateX(100%) rotate(45deg); }
    }
`;
document.head.appendChild(style);