document.addEventListener("DOMContentLoaded", () => {
    class PoseDetector {
        constructor() {
            this.video = document.getElementById('videoElement');
            this.canvas = document.getElementById('canvasElement');
            this.ctx = this.canvas.getContext('2d');
            this.startBtn = document.getElementById('startBtn');
            this.stopBtn = document.getElementById('stopBtn');
            this.switchBtn = document.getElementById('switchBtn');
            this.status = document.getElementById('status');
            this.poseInfo = document.getElementById('poseInfo');
            this.keypointCount = document.getElementById('keypointCount');
            this.fpsCounter = document.getElementById('fpsCounter');
            this.neckAngle = document.getElementById('neckAngle');
            
            this.postureDisplay = document.getElementById('postureDisplay');
            this.postureStatusLarge = document.getElementById('postureStatusLarge');
            this.statusIcon = document.getElementById('statusIcon');
            this.statusTitle = document.getElementById('statusTitle');
            this.statusSubtitle = document.getElementById('statusSubtitle');
            this.postureTimer = document.getElementById('postureTimer');
            this.timerValue = document.getElementById('timerValue');
            this.timerFill = document.getElementById('timerFill');
            this.postureAlert = document.getElementById('postureAlert');
            
            this.stream = null;
            this.currentCamera = 0;
            this.cameras = [];
            this.pose = null;
            this.isModelLoaded = false;
            
            // posture analysis variables: may consider calibrating or adding adjustablility
            this.postureThresholds = {
                perfect: 180,    // theoretically perfect alignment
                good: 168,       // yellow range
                warning: 160     // warning threshold: bad posture  
            };
            this.currentNeckAngle = 180;
            
            // warning tracking
            this.poorPostureStartTime = null;
            this.poorPostureDuration = 0;
            this.warningDurationThreshold = 10000; // 10 seconds in milliseconds
            this.alertShown = false;
            this.alertTimeout = null;
            
            // fps tracking
            this.frameCount = 0;
            this.lastTime = performance.now();
            this.fps = 0;
            
            this.initializePoseDetection();
            this.bindEvents();
        }

        async initializePoseDetection() {
            try {
                // check mediapipe pose availability
                if (typeof Pose === 'undefined') {
                    throw new Error('MediaPipe Pose not loaded');
                }

                this.updateStatus('<div class="loading"></div>Initializing pose detection...');

                // init pose model
                this.pose = new Pose({
                    locateFile: (file) => {
                        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
                    }
                });

                // pose model configuration
                this.pose.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    smoothSegmentation: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });

                this.pose.onResults((results) => {
                    this.onResults(results);
                });

                this.isModelLoaded = true;
                this.updateStatus('✅ Pose detection ready - Click "Start Camera"');
                this.startBtn.disabled = false;

            } catch (error) {
                console.error('MediaPipe initialization failed:', error);
                this.initializeFallbackDetection();
            }
        }

        initializeFallbackDetection() {
            // fallback to basic camera mode without pose detection
            this.updateStatus('⚠️ Using basic camera mode (pose detection unavailable)');
            this.startBtn.disabled = false;
            this.isModelLoaded = false;
        }

        bindEvents() {
            this.startBtn.addEventListener('click', () => this.startCamera());
            this.stopBtn.addEventListener('click', () => this.stopCamera());
            this.switchBtn.addEventListener('click', () => this.switchCamera());
            
            window.addEventListener('resize', () => this.resizeCanvas());
        }

        async getCameras() {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                this.cameras = devices.filter(device => device.kind === 'videoinput');
                return this.cameras.length > 0;
            } catch (error) {
                console.error('Error getting cameras:', error);
                return false;
            }
        }

        async startCamera() {
            this.updateStatus('<div class="loading"></div>Starting camera...');
            
            try {
                const hasCameras = await this.getCameras();
                if (!hasCameras) {
                    this.updateStatus('❌ No cameras found');
                    return;
                }

                const constraints = {
                    video: {
                        deviceId: this.cameras[this.currentCamera]?.deviceId,
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: this.cameras.length > 1 ? undefined : 'user'
                    }
                };

                this.stream = await navigator.mediaDevices.getUserMedia(constraints);
                this.video.srcObject = this.stream;
                
                this.video.addEventListener('loadedmetadata', () => {
                    this.resizeCanvas();
                    if (this.isModelLoaded) {
                        this.startPoseDetection();
                    } else {
                        this.startBasicMode();
                    }
                });

                this.startBtn.disabled = true;
                this.stopBtn.disabled = false;
                this.switchBtn.disabled = this.cameras.length <= 1;
                
                const status = this.isModelLoaded ? 
                    'Detecting poses...' : 
                    'Camera active (basic mode)';
                this.updateStatus(status);
                
                this.poseInfo.style.display = 'flex';
                this.postureDisplay.style.display = 'block';

            } catch (error) {
                console.error('Error starting camera:', error);
                this.updateStatus('❌ Camera access denied');
            }
        }

        startBasicMode() {
            // Just show the camera feed without pose detection
            const animate = () => {
                if (this.stream) {
                    this.updateFPS();
                    requestAnimationFrame(animate);
                }
            };
            animate();
        }

        async startPoseDetection() {
            const detectPose = async () => {
                if (!this.stream || this.video.readyState !== 4) {
                    if (this.stream) requestAnimationFrame(detectPose);
                    return;
                }

                try {
                    await this.pose.send({ image: this.video });
                } catch (error) {
                    console.warn('Pose detection error:', error);
                }
                
                if (this.stream) {
                    requestAnimationFrame(detectPose);
                }
            };

            detectPose();
        }

        onResults(results) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            if (results.poseLandmarks && results.poseLandmarks.length > 0) {
                this.drawPose(results.poseLandmarks);
                this.analyzePosePosture(results.poseLandmarks);
                this.updatePoseStats(results.poseLandmarks);
            }
            
            this.updateFPS();
        }

        analyzePosePosture(landmarks) {
            // pose landmark indices:
            // 7: left ear, 8: right ear
            // 11: left shoulder, 12: right shoulder
            
            const leftEar = landmarks[7];
            const rightEar = landmarks[8];
            const leftShoulder = landmarks[11];
            const rightShoulder = landmarks[12];
            
            // check required landmarks visibility
            const requiredLandmarks = [leftEar, rightEar, leftShoulder, rightShoulder];
            const hasGoodVisibility = requiredLandmarks.every(landmark => 
                landmark && (landmark.visibility || 1) > 0.6
            );
            
            if (!hasGoodVisibility) {
                this.updatePostureStatus('unknown', '?', 'Keypoints not visible', 'Position yourself within the frame');
                this.resetPoorPostureTimer();
                return;
            }
            
            // calculate average positions (for better stability)
            const avgEar = {
                x: (leftEar.x + rightEar.x) / 2,
                y: (leftEar.y + rightEar.y) / 2
            };
            
            const avgShoulder = {
                x: (leftShoulder.x + rightShoulder.x) / 2,
                y: (leftShoulder.y + rightShoulder.y) / 2
            };
            
            // calculate neck angle 
            const deltaX = avgEar.x - avgShoulder.x;
            const deltaY = avgShoulder.y - avgEar.y; // inverted because screen coordinates
            
            // calculate angle in degrees 
            let angle = Math.atan2(Math.abs(deltaX), deltaY) * (180 / Math.PI);
            
            // convert to scale where 180° is perfect 
            this.currentNeckAngle = 180 - Math.abs(angle);
            
            // determine posture quality and handle persistence
            this.handlePosturePersistence();
            
            // draw posture analysis lines
            this.drawPostureAnalysis(avgEar, avgShoulder);
        }

        handlePosturePersistence() {
            const currentTime = Date.now();
            let postureQuality, title, subtitle;
            
            // determine and display current posture quality
            if (this.currentNeckAngle >= this.postureThresholds.good) {
                postureQuality = 'good';
                title = 'Excellent Posture!';
                subtitle = `${Math.round(this.currentNeckAngle)}° - Keep it up!`;
                this.resetPoorPostureTimer();
            } else if (this.currentNeckAngle >= this.postureThresholds.warning) {
                postureQuality = 'fair';
                title = 'Fair Posture';
                subtitle = `${Math.round(this.currentNeckAngle)}° - Could be better`;
                this.resetPoorPostureTimer();
            } else {
                // poor posture detected
                postureQuality = 'poor';
                
                if (this.poorPostureStartTime === null) {
                    // first detection of poor posture
                    this.poorPostureStartTime = currentTime;
                    this.poorPostureDuration = 0;
                } else {
                    // update duration
                    this.poorPostureDuration = currentTime - this.poorPostureStartTime;
                }
                
                const remainingTime = Math.max(0, this.warningDurationThreshold - this.poorPostureDuration);
                const secondsRemaining = Math.ceil(remainingTime / 1000);
                
                if (this.poorPostureDuration >= this.warningDurationThreshold) {
                    title = 'Poor Posture Alert!';
                    subtitle = `${Math.round(this.currentNeckAngle)}° - Straighten up now!`;
                    this.showPostureAlert();
                } else {
                    title = 'Poor Posture Detected';
                    subtitle = `${Math.round(this.currentNeckAngle)}° - Warning in ${secondsRemaining}s`;
                    this.hidePostureAlert();
                }
                
                this.updatePostureTimer();
            }
            
            this.updatePostureStatus(postureQuality, this.currentNeckAngle, title, subtitle);
        }

        resetPoorPostureTimer() {
            this.poorPostureStartTime = null;
            this.poorPostureDuration = 0;
            this.postureTimer.style.display = 'none';
            this.hidePostureAlert();
        }

        updatePostureTimer() {
            if (this.poorPostureStartTime === null) return;
            
            this.postureTimer.style.display = 'block';
            
            const seconds = Math.floor(this.poorPostureDuration / 1000);
            this.timerValue.textContent = `${seconds}s`;
            
            const progress = Math.min(this.poorPostureDuration / this.warningDurationThreshold, 1);
            this.timerFill.style.width = `${progress * 100}%`;
        }

        drawPostureAnalysis(avgEar, avgShoulder) {
            const earX = avgEar.x * this.canvas.width;
            const earY = avgEar.y * this.canvas.height;
            const shoulderX = avgShoulder.x * this.canvas.width;
            const shoulderY = avgShoulder.y * this.canvas.height;
            
            // draw vertical reference line from shoulders
            this.ctx.strokeStyle = 'rgba(107, 207, 127, 0.8)';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(shoulderX, shoulderY - 100);
            this.ctx.lineTo(shoulderX, shoulderY + 50);
            this.ctx.stroke();
            
            // draw line from shoulder to ear
            const color = this.currentNeckAngle >= this.postureThresholds.good ? 
                'rgba(107, 207, 127, 0.8)' : 
                this.currentNeckAngle >= this.postureThresholds.warning ?
                'rgba(255, 217, 61, 0.8)' : 
                'rgba(255, 107, 107, 0.8)';
            
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 4;
            this.ctx.setLineDash([]);
            this.ctx.beginPath();
            this.ctx.moveTo(shoulderX, shoulderY);
            this.ctx.lineTo(earX, earY);
            this.ctx.stroke();
            
            // draw angle visualization
            this.drawAngleVisualization(shoulderX, shoulderY, earX, earY);
        }

        drawAngleVisualization(shoulderX, shoulderY, earX, earY) {
            const radius = 50;
            
            // calculate the angle from vertical 
            const deltaX = earX - shoulderX;
            const deltaY = earY - shoulderY;
            const angleFromVertical = Math.atan2(deltaX, deltaY);
            
            // draw angle arc from vertical to neck line
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(shoulderX, shoulderY, radius, -Math.PI/2, angleFromVertical, deltaX > 0);
            this.ctx.stroke();
            
            // draw angle measurement text
            this.ctx.fillStyle = 'white';
            this.ctx.font = 'bold 16px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            this.ctx.lineWidth = 3;
            
            const textX = shoulderX + (deltaX > 0 ? radius + 30 : -radius - 30);
            const textY = shoulderY - 20;
            
            this.ctx.strokeText(`${Math.round(this.currentNeckAngle)}°`, textX, textY);
            this.ctx.fillText(`${Math.round(this.currentNeckAngle)}°`, textX, textY);
            
            // add perfect value reference
            //this.ctx.font = 'bold 12px Arial';
            //this.ctx.fillStyle = 'rgba(107, 207, 127, 0.9)';
            //this.ctx.fillText('Perfect: 180°', textX, textY + 20);
        }

        updatePostureStatus(quality, angle, title, subtitle) {
            // update angle display
            this.neckAngle.textContent = `${Math.round(angle)}°`;
            
            // update large posture display
            this.statusTitle.textContent = title;
            this.statusSubtitle.textContent = subtitle;
            
            // update display styling and icon
            this.postureDisplay.className = `posture-display ${quality}`;
            
            // update status icon based on quality
            const icons = {
                good: '✅',
                fair: '⚠️', 
                poor: '❌',
                unknown: '👤'
            };
            this.statusIcon.textContent = icons[quality] || '👤';
        }

        showPostureAlert() {
            if (!this.alertShown) {
                this.postureAlert.style.display = 'block';
                this.alertShown = true;

                const audio = new Audio('resources/alert.mp3');
                audio.play();
                
                // auto hide after 5 seconds if posture improves
                if (this.alertTimeout) clearTimeout(this.alertTimeout);
                this.alertTimeout = setTimeout(() => {
                    if (this.currentNeckAngle <= this.postureThresholds.fair) {
                        this.hidePostureAlert();
                    }
                }, 5000);
            }
        }

        hidePostureAlert() {
            if (this.alertShown) {
                this.postureAlert.style.display = 'none';
                this.alertShown = false;
                if (this.alertTimeout) {
                    clearTimeout(this.alertTimeout);
                    this.alertTimeout = null;
                }
            }
        }

        drawPose(landmarks) {
            // draw connections
            this.drawConnections(landmarks);
            
            // draw keypoints (only major ones)
            landmarks.forEach((landmark, index) => {
                // select only ears and shoulders
                if (index === 7 || index === 8 || index === 11 || index === 12) {
                    const x = landmark.x * this.canvas.width;
                    const y = landmark.y * this.canvas.height;
                    const visibility = landmark.visibility || 1;
                    
                    if (visibility > 0.5) {
                        this.ctx.beginPath();
                        this.ctx.arc(x, y, 5, 0, 2 * Math.PI);
                        this.ctx.fillStyle = this.getKeypointColor(index);
                        this.ctx.fill();
                        this.ctx.strokeStyle = 'white';
                        this.ctx.lineWidth = 2;
                        this.ctx.stroke();
                    }
                }
            });
        }

        drawConnections(landmarks) {
            const connections = [
                [11, 12] // shows only shoulders, can be updated to include more if needed
            ];

            this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
            this.ctx.lineWidth = 3;

            connections.forEach(([start, end]) => {
                const startPoint = landmarks[start];
                const endPoint = landmarks[end];
                
                if (startPoint && endPoint && 
                    (startPoint.visibility || 1) > 0.5 && 
                    (endPoint.visibility || 1) > 0.5) {
                    
                    this.ctx.beginPath();
                    this.ctx.moveTo(startPoint.x * this.canvas.width, startPoint.y * this.canvas.height);
                    this.ctx.lineTo(endPoint.x * this.canvas.width, endPoint.y * this.canvas.height);
                    this.ctx.stroke();
                }
            });
        }

        getKeypointColor(index) {
            const colors = [
                '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
                '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
            ];
            return colors[index % colors.length];
        }

        updatePoseStats(landmarks) {
            // filtered for only ears and shoulders
            const visibleLandmarks = landmarks
                .map((l, i) => ({ ...l, index: i }))
                .filter(l => [7, 8, 11, 12].includes(l.index) && (l.visibility || 1) > 0.5);
            // CONST USED AS LANDMARKS.LENGTH = 4, TO REFER TO ONLY 4 KPs
            this.keypointCount.textContent = `${visibleLandmarks.length}/4`;
        }

        updateFPS() {
            this.frameCount++;
            const currentTime = performance.now();
            
            if (currentTime - this.lastTime >= 1000) {
                this.fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastTime));
                this.fpsCounter.textContent = this.fps;
                this.frameCount = 0;
                this.lastTime = currentTime;
            }
        }

        stopCamera() {
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }
            
            this.video.srcObject = null;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            this.startBtn.disabled = false;
            this.stopBtn.disabled = true;
            this.switchBtn.disabled = true;
            
            this.updateStatus('📷 Camera stopped');
            this.poseInfo.style.display = 'none';
            this.postureDisplay.style.display = 'none';
            this.resetPoorPostureTimer();
        }

        async switchCamera() {
            if (this.cameras.length <= 1) return;
            
            this.currentCamera = (this.currentCamera + 1) % this.cameras.length;
            this.stopCamera();
            setTimeout(() => this.startCamera(), 500);
        }

        resizeCanvas() {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.canvas.style.width = this.video.offsetWidth + 'px';
            this.canvas.style.height = this.video.offsetHeight + 'px';
        }

        updateStatus(message) {
            this.status.innerHTML = message;
        }
    }

    // initialize when page loads
    window.addEventListener('load', () => {
        setTimeout(() => {
            console.log('Checking MediaPipe availability...');
            console.log('Pose available:', typeof Pose !== 'undefined');
            new PoseDetector();
        }, 1000);
    });
});
