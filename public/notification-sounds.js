/**
 * Notification Sound Manager
 * Handles audio notifications for orders and warnings
 */

class NotificationSoundManager {
    constructor() {
        this.enabled = this.getSoundPreference();
        this.sounds = {
            newOrder: this.createAudioElement('newOrder', 900, 0.3, 150), // Gentle ping
            warning: this.createAudioElement('warning', 600, 0.4, 200),   // More urgent
            urgent: this.createAudioElement('urgent', 400, 0.5, 250)      // Very urgent
        };
    }

    /**
     * Create an audio element using Web Audio API
     * This generates a simple notification sound without needing external files
     */
    createAudioElement(type, frequency, volume, duration) {
        return {
            type,
            frequency,
            volume,
            duration,
            play: () => this.playTone(frequency, volume, duration)
        };
    }

    /**
     * Play a notification tone using Web Audio API
     */
    playTone(frequency, volume, duration) {
        if (!this.enabled) return;

        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration / 1000);
        } catch (error) {
            console.error('Error playing notification sound:', error);
        }
    }

    /**
     * Play sound for new order
     */
    playNewOrderSound() {
        this.sounds.newOrder.play();
    }

    /**
     * Play warning sound based on urgency level
     */
    playWarningSound(level) {
        if (level >= 3) {
            // Level 3 and 4 are urgent
            this.sounds.urgent.play();
        } else {
            // Level 1 and 2 are warnings
            this.sounds.warning.play();
        }
    }

    /**
     * Enable/disable notification sounds
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        localStorage.setItem('notificationSoundsEnabled', enabled ? 'true' : 'false');
    }

    /**
     * Get sound preference from localStorage
     */
    getSoundPreference() {
        const saved = localStorage.getItem('notificationSoundsEnabled');
        return saved === null ? true : saved === 'true'; // Default to enabled
    }

    /**
     * Check if sounds are enabled
     */
    isEnabled() {
        return this.enabled;
    }
}

// Create global instance
window.notificationSounds = new NotificationSoundManager();
