/**
 * Handwriting Digit Recognition Engine
 * Model: MLP 784 -> 128 (ReLU) -> 64 (ReLU) -> 10 (Softmax)
 * Preprocessing: Center of Mass alignment + 20x20 bounding box to 28x28 MNIST specification
 */

class DigitRecognitionEngine {
    constructor() {
        this.weights = null;
        this.isReady = false;
        this.init();
    }

    init() {
        if (typeof window !== 'undefined' && window.MNIST_WEIGHTS) {
            this.weights = window.MNIST_WEIGHTS;
            this.isReady = true;
            console.log(`[DigitAI] Neural Network ready! Accuracy: ${(this.weights.accuracy * 100).toFixed(2)}%`);
        } else {
            console.warn('[DigitAI] MNIST_WEIGHTS not found yet.');
        }
    }

    /**
     * Preprocesses the source canvas to a 28x28 MNIST standard input.
     * 1. Finds bounding box of strokes.
     * 2. Scales the largest dimension to 20px while preserving aspect ratio.
     * 3. Centers the digit based on its center of mass into 28x28.
     */
    preprocessCanvas(srcCanvas) {
        const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
        const width = srcCanvas.width;
        const height = srcCanvas.height;
        const imgData = srcCtx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // 1. Find bounding box
        let minX = width, minY = height, maxX = 0, maxY = 0;
        let hasInk = false;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const alpha = data[idx + 3];
                // Check if drawn pixel (dark strokes on transparent/white OR alpha > 20)
                if (alpha > 25) {
                    hasInk = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!hasInk || maxX <= minX || maxY <= minY) {
            return { hasInk: false, inputTensor: null, previewCanvas: null };
        }

        const boxW = maxX - minX + 1;
        const boxH = maxY - minY + 1;

        // 2. Scale into 20x20 box inside temporary canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 28;
        tempCanvas.height = 28;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, 28, 28);

        // Aspect ratio scaling
        let drawW, drawH;
        if (boxW > boxH) {
            drawW = 20;
            drawH = Math.max(1, Math.round(boxH * (20 / boxW)));
        } else {
            drawH = 20;
            drawW = Math.max(1, Math.round(boxW * (20 / boxH)));
        }

        // Draw cropped & scaled stroke onto an intermediate canvas
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = boxW;
        cropCanvas.height = boxH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(srcCanvas, minX, minY, boxW, boxH, 0, 0, boxW, boxH);

        // Render roughly at center of 28x28 (pos 4 to 24 approx)
        const initX = Math.round((28 - drawW) / 2);
        const initY = Math.round((28 - drawH) / 2);
        
        // Use high-quality smoothing for downsizing
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';

        // Draw with white stroke on black background (standard MNIST format)
        // First draw on a temp buffer to convert colors
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = drawW;
        scaledCanvas.height = drawH;
        const scaledCtx = scaledCanvas.getContext('2d');
        scaledCtx.drawImage(cropCanvas, 0, 0, boxW, boxH, 0, 0, drawW, drawH);
        
        const scaledData = scaledCtx.getImageData(0, 0, drawW, drawH);
        for (let i = 0; i < scaledData.data.length; i += 4) {
            const alpha = scaledData.data[i + 3] / 255;
            // Get darkness of stroke
            const r = scaledData.data[i];
            const g = scaledData.data[i + 1];
            const b = scaledData.data[i + 2];
            const darkness = 1 - ((r + g + b) / (3 * 255));
            const intensity = Math.round(darkness * alpha * 255);
            scaledData.data[i] = intensity;
            scaledData.data[i + 1] = intensity;
            scaledData.data[i + 2] = intensity;
            scaledData.data[i + 3] = 255;
        }
        scaledCtx.putImageData(scaledData, 0, 0);

        tempCtx.drawImage(scaledCanvas, initX, initY);

        // 3. Center of Mass calculation
        const centeredData = tempCtx.getImageData(0, 0, 28, 28);
        const pixels = centeredData.data;

        let totalMass = 0;
        let sumX = 0;
        let sumY = 0;

        for (let y = 0; y < 28; y++) {
            for (let x = 0; x < 28; x++) {
                const idx = (y * 28 + x) * 4;
                const mass = pixels[idx]; // Greyscale value 0~255
                if (mass > 0) {
                    totalMass += mass;
                    sumX += x * mass;
                    sumY += y * mass;
                }
            }
        }

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = 28;
        finalCanvas.height = 28;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.fillStyle = '#000000';
        finalCtx.fillRect(0, 0, 28, 28);

        if (totalMass > 0) {
            const cX = sumX / totalMass;
            const cY = sumY / totalMass;
            // Shift to center (14, 14)
            const shiftX = Math.round(14 - cX);
            const shiftY = Math.round(14 - cY);
            finalCtx.drawImage(tempCanvas, shiftX, shiftY);
        } else {
            finalCtx.drawImage(tempCanvas, 0, 0);
        }

        // 4. Extract 784 float values (0.0 to 1.0)
        const finalImgData = finalCtx.getImageData(0, 0, 28, 28);
        const tensor = new Float32Array(784);
        for (let i = 0; i < 784; i++) {
            tensor[i] = finalImgData.data[i * 4] / 255.0;
        }

        return {
            hasInk: true,
            inputTensor: tensor,
            previewCanvas: finalCanvas,
            boundingBox: { x: minX, y: minY, width: boxW, height: boxH }
        };
    }

    /**
     * Executes forward pass of MLP neural network
     */
    predict(tensor) {
        if (!this.isReady || !this.weights) {
            this.init();
            if (!this.isReady) {
                throw new Error('Model weights not loaded.');
            }
        }

        const { w1, b1, w2, b2, w3, b3 } = this.weights;

        // Layer 1: 784 -> 128 (ReLU)
        const h1 = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
            let sum = b1[j];
            for (let i = 0; i < 784; i++) {
                sum += tensor[i] * w1[i * 128 + j];
            }
            h1[j] = sum > 0 ? sum : 0; // ReLU
        }

        // Layer 2: 128 -> 64 (ReLU)
        const h2 = new Float32Array(64);
        for (let j = 0; j < 64; j++) {
            let sum = b2[j];
            for (let i = 0; i < 128; i++) {
                sum += h1[i] * w2[i * 64 + j];
            }
            h2[j] = sum > 0 ? sum : 0; // ReLU
        }

        // Layer 3: 64 -> 10 (Softmax)
        const logits = new Float32Array(10);
        let maxLogit = -Infinity;
        for (let j = 0; j < 10; j++) {
            let sum = b3[j];
            for (let i = 0; i < 64; i++) {
                sum += h2[i] * w3[i * 10 + j];
            }
            logits[j] = sum;
            if (sum > maxLogit) maxLogit = sum;
        }

        // Softmax with numerical stability
        let expSum = 0;
        const probs = new Float32Array(10);
        for (let j = 0; j < 10; j++) {
            const e = Math.exp(logits[j] - maxLogit);
            probs[j] = e;
            expSum += e;
        }
        for (let j = 0; j < 10; j++) {
            probs[j] /= expSum;
        }

        // Format results
        const probabilityList = [];
        let topDigit = 0;
        let maxProb = -1;

        for (let d = 0; d < 10; d++) {
            const p = probs[d];
            probabilityList.push({
                digit: d,
                probability: p,
                percentage: (p * 100).toFixed(1)
            });
            if (p > maxProb) {
                maxProb = p;
                topDigit = d;
            }
        }

        // Sort Top 3
        const sorted = [...probabilityList].sort((a, b) => b.probability - a.probability);

        return {
            topDigit,
            confidence: maxProb,
            confidencePercent: (maxProb * 100).toFixed(1),
            probabilities: probabilityList,
            top3: sorted.slice(0, 3)
        };
    }
}

// Export instance
if (typeof window !== 'undefined') {
    window.digitEngine = new DigitRecognitionEngine();
}
