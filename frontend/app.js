// app.js — Frontend application for Fitness Tracker

/**
 * Fitness Tracker - Frontend Application
 * 
 * This module provides the client-side logic for the Fitness Tracker PWA.
 * It handles tab switching, workout logging with timer, and API communication.
 */

// Import exercises list
import { exercises as exerciseList } from './exercises.js';

// Camera functionality (stub - for future barcode scanning)
const camera = {
    /**
     * Initialize camera for barcode scanning
     */
    async initialize() {
        console.log('Camera initialization - TODO');
    },
    
    /**
     * Capture image from camera
     */
    async capture() {
        console.log('Capture image - TODO');
    }
};

// API communication
const api = {
    /**
     * Base URL for the backend API
     */
    get baseUrl() {
        return window.location.origin;
    },
    
    /**
     * Generic GET request
     */
    async get(path) {
        try {
            const response = await fetch(`${this.baseUrl}${path}`);
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            console.error('API GET error:', error);
            throw error;
        }
    },
    
    /**
     * Generic POST request
     */
    async post(path, data) {
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            console.error('API POST error:', error);
            throw error;
        }
    },
    
    /**
     * Generic PATCH request
     */
    async patch(path, data) {
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            console.error('API PATCH error:', error);
            throw error;
        }
    },
    
    /**
     * Generic PUT request
     */
    async put(path, data) {
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            console.error('API PUT error:', error);
            throw error;
        }
    },

    /**
     * Generic DELETE request
     */
    async delete(path) {
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            console.error('API DELETE error:', error);
            throw error;
        }
    }
};

// Backend timestamps (e.g. Workout.started_at) are naive UTC - Python's
// datetime.utcnow().isoformat() with no timezone suffix. JS's Date parser
// treats a timezone-less "date-time" string as LOCAL time, not UTC, so
// parsing it directly would silently shift by the local UTC offset (2
// hours added, for example, in CEST). Appending "Z" forces correct UTC
// interpretation.
function parseUtcTimestamp(isoString) {
    if (!isoString) return null;
    const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(isoString);
    return new Date(hasTz ? isoString : `${isoString}Z`);
}

// Timer functionality for active workout.
//
// Elapsed time is computed from a stored start timestamp (Date.now() diff)
// rather than incremented once per tick. A plain "seconds++ every 1000ms"
// counter silently falls behind whenever the browser throttles/pauses
// setInterval - which mobile Safari does aggressively for backgrounded or
// screen-locked tabs, exactly the situation a mid-workout phone is often
// in. Computing from a timestamp means every tick (whenever it actually
// fires) always shows the true elapsed time, never a stale undercount.
const timer = {
    intervalId: null,
    startTimestamp: null,

    /**
     * Start ticking. Pass the workout's real started_at (ISO string) so the
     * displayed time is anchored to when the workout actually started on
     * the server, not just to whenever this function happened to run.
     */
    start(startedAtIso) {
        this.stop();
        this.startTimestamp = startedAtIso ? parseUtcTimestamp(startedAtIso).getTime() : Date.now();
        updateTimerDisplay(this.seconds);
        this.intervalId = setInterval(() => {
            updateTimerDisplay(this.seconds);
        }, 1000);
    },

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    },

    reset() {
        this.stop();
        this.startTimestamp = null;
        updateTimerDisplay(0);
    },

    /** Elapsed whole seconds since start, computed fresh every read - never drifts or goes stale */
    get seconds() {
        if (this.startTimestamp === null) return 0;
        return Math.max(0, Math.floor((Date.now() - this.startTimestamp) / 1000));
    },

    getFormattedTime() {
        const mins = Math.floor(this.seconds / 60);
        const secs = this.seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
};

// Active workout state
let activeWorkout = null;
let activeMeal = null; // { id, isPastEdit } while editing a past meal in the meal builder
let exercisesData = [];
let currentExerciseNameFilter = '';
let customExercises = []; // User-added exercise names, persisted via /exercises/custom
let loggedExerciseNames = []; // Distinct names already used in logged workouts (e.g. imported history)

async function loadCustomExercises() {
    try {
        const data = await api.get('/exercises/custom');
        customExercises = data.map(e => e.name);
    } catch (error) {
        console.error('Error loading custom exercises:', error);
    }
}

async function loadLoggedExerciseNames() {
    try {
        loggedExerciseNames = await api.get('/exercises/names');
    } catch (error) {
        console.error('Error loading logged exercise names:', error);
    }
}

// Knee-strengthening list settings (view/add/remove) - a prioritized
// category the user defined from physio guidance, referenced by the
// Recommended Workout suggestion. Not presented as medical advice.
async function loadKneeExercises() {
    const container = document.getElementById('knee-exercise-list');
    if (!container) return;
    try {
        const entries = await api.get('/knee-exercises');
        renderKneeExercises(entries);
    } catch (error) {
        console.error('Error loading knee exercises:', error);
        container.textContent = 'Failed to load.';
    }
}

function renderKneeExercises(entries) {
    const container = document.getElementById('knee-exercise-list');
    if (!container) return;

    if (!entries || entries.length === 0) {
        container.className = 'empty-state';
        container.textContent = 'No knee-strengthening exercises yet.';
        return;
    }

    container.className = '';
    container.innerHTML = entries.map(entry => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid #f0f0f0;">
            <span>${entry.name}</span>
            <button data-knee-id="${entry.id}" class="knee-exercise-remove-btn" style="background: none; border: none; color: #dc3545; font-size: 1.1rem; cursor: pointer; padding: 0.25rem;">&times;</button>
        </div>
    `).join('');

    container.querySelectorAll('.knee-exercise-remove-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await api.delete(`/knee-exercises/${btn.dataset.kneeId}`);
                loadKneeExercises();
            } catch (error) {
                console.error('Error removing knee exercise:', error);
                alert('Failed to remove exercise');
            }
        });
    });
}

// Tab switching functionality
function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Remove active class from all contents
            contents.forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab
            tab.classList.add('active');
            
            // Show corresponding content
            const tabId = tab.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
            
            // Load data for Workout tab
            if (tabId === 'workout') {
                loadWorkouts();
                if (!activeWorkout) {
                    document.getElementById('start-workout-section').style.display = 'block';
                }
            }

            // Load the nutrition diary (saved meals) and meal templates for Food tab
            if (tabId === 'food') {
                loadNutritionDiary();
                if (typeof foodSearch !== 'undefined') foodSearch.loadMealTemplates();
            }

            // Load check-ins for Check-in tab
            if (tabId === 'checkin' && typeof checkin !== 'undefined') {
                checkin.loadCheckins();
            }

            // Refresh Today's Overview when returning to it
            if (tabId === 'today' && typeof today !== 'undefined') {
                today.loadToday();
            }

            // Refresh charts for the Progress tab
            if (tabId === 'progress' && typeof progress !== 'undefined') {
                progress.load();
            }
        });
    });
}

// Format seconds as mm:ss
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Update timer display
function updateTimerDisplay(seconds) {
    document.getElementById('workout-timer').textContent = formatTime(seconds);
}

// Merge the hardcoded list, names already logged in the database, and persisted
// custom exercises into one de-duplicated (case-insensitive) list
function getAllExerciseNames() {
    const seen = new Set();
    const combined = [];
    for (const name of exerciseList.concat(loggedExerciseNames, customExercises)) {
        const key = name.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            combined.push(name);
        }
    }
    return combined;
}

// Filter exercises based on search term
function filterExercises(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const allExercises = getAllExerciseNames();
    if (!term) return allExercises;

    return allExercises.filter(ex => ex.toLowerCase().includes(term));
}

// Show exercise picker modal
function showExercisePicker() {
    console.log('showExercisePicker called');
    
    // Create modal overlay if not exists
    let modal = document.getElementById('exercise-picker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'exercise-picker-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            border-radius: 12px;
            width: 90%;
            max-width: 400px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
        `;
        
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 1rem;
            border-bottom: 1px solid #eee;
        `;
        
        const title = document.createElement('h3');
        title.textContent = 'Select Exercise';
        title.style.marginBottom = '0.5rem';
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search exercises...';
        searchInput.style.cssText = `
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 1rem;
        `;
        
        searchInput.addEventListener('input', (e) => {
            currentExerciseNameFilter = e.target.value;
            renderExerciseList();
        });
        
        header.appendChild(title);
        header.appendChild(searchInput);
        
        const list = document.createElement('div');
        list.id = 'exercise-list';
        list.style.cssText = `
            padding: 0.5rem;
            overflow-y: auto;
            flex: 1;
        `;
        
        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 1rem;
            border-top: 1px solid #eee;
        `;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Cancel';
        closeBtn.className = 'btn btn-secondary';
        closeBtn.style.width = '100%';
        closeBtn.onclick = hideExercisePicker;
        
        footer.appendChild(closeBtn);
        
        content.appendChild(header);
        content.appendChild(list);
        content.appendChild(footer);
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        // Render initial list
        renderExerciseList();
    } else {
        modal.style.display = 'flex';
        // Clear replaceIndex when just opening the picker to add a new exercise
        delete modal.dataset.replaceIndex;
        currentExerciseNameFilter = '';
        document.querySelector('#exercise-picker-modal input').value = '';
        renderExerciseList();
    }
}

// Hide exercise picker modal
function hideExercisePicker() {
    const modal = document.getElementById('exercise-picker-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Render exercise list in picker
function renderExerciseList() {
    const list = document.getElementById('exercise-list');
    if (!list) return;

    const term = currentExerciseNameFilter.trim();
    const filtered = filterExercises(term);

    let html = '';
    if (filtered.length === 0) {
        html += '<p style="text-align: center; color: #888;">No exercises found</p>';
    } else {
        html += filtered.map(exercise => `
            <div class="card" style="cursor: pointer; margin-bottom: 0.5rem;">
                <div onclick="selectExercise('${exercise.replace(/'/g, "\\'")}')">
                    <strong>${exercise}</strong>
                </div>
            </div>
        `).join('');
    }

    // Offer to add the typed text as a new custom exercise, unless it's an
    // exact (case-insensitive) match for something already in the list
    const exactMatch = term && filtered.some(ex => ex.toLowerCase() === term.toLowerCase());
    if (term && !exactMatch) {
        html += `
            <div class="card" style="cursor: pointer; margin-bottom: 0.5rem; border: 1px dashed #999;">
                <div onclick="addCustomExercise('${term.replace(/'/g, "\\'")}')">
                    <strong>+ Add "${term}"</strong>
                </div>
            </div>
        `;
    }

    list.innerHTML = html;
}

// Select an exercise from picker
// Add a typed exercise name that wasn't in the list: persist it so it appears
// in the picker on future workouts, then add it to the current workout
window.addCustomExercise = async function(name) {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (!customExercises.some(ex => ex.toLowerCase() === trimmed.toLowerCase())) {
        customExercises.push(trimmed);
    }

    try {
        await api.post('/exercises/custom', { name: trimmed });
    } catch (error) {
        console.error('Error saving custom exercise for future use:', error);
    }

    selectExercise(trimmed);
};

// Fetch the sets from the last time this exercise was logged, for the read-only
// "Previous" column. Display-only reference info - never overwrites current inputs.
async function loadPreviousSetsForExercise(exercise) {
    try {
        const params = new URLSearchParams({ name: exercise.name });
        if (activeWorkout && activeWorkout.id) {
            params.set('exclude_workout_id', activeWorkout.id);
        }
        const data = await api.get(`/exercises/previous?${params.toString()}`);
        exercise.previousSets = data.sets || [];
    } catch (error) {
        console.error('Error loading previous sets for', exercise.name, error);
        exercise.previousSets = [];
    }
    renderExercises();
}

// Format a previous set for display, e.g. "45 kg × 8" or "30s hold", with a
// red "F" appended when that set was taken to failure.
function formatPreviousSet(prev) {
    if (!prev) return null;
    const parts = [];
    if (prev.weight_kg !== null && prev.weight_kg !== undefined) parts.push(`${prev.weight_kg} kg`);
    if (prev.reps !== null && prev.reps !== undefined) parts.push(`${prev.reps}`);
    let text = parts.join(' × ');
    if (prev.hold_seconds !== null && prev.hold_seconds !== undefined) {
        text = text ? `${text} · ${prev.hold_seconds}s hold` : `${prev.hold_seconds}s hold`;
    }
    if (!text) return null;
    if (prev.to_failure) {
        text += ' <span style="color: #dc3545; font-weight: bold;">F</span>';
    }
    return text;
}

// Add a new exercise (by name) to the active workout: pushes it locally,
// persists it, then reconciles the local copy with the saved id. Shared by
// the exercise picker's "add new" path and the recommended-workout
// "Start this workout" flow, which adds several exercises the same way.
async function addExerciseByName(name) {
    const newExercise = {
        id: null,
        workout_id: activeWorkout.id,
        name,
        order: exercisesData.length + 1,
        sets: []
    };
    exercisesData.push(newExercise);

    try {
        const savedExercise = await saveExerciseToBackend(newExercise, true);
        const tempIndex = exercisesData.findIndex(ex => !ex.id);
        if (tempIndex !== -1) {
            // Make a deep copy of the saved exercise to avoid reference issues
            exercisesData[tempIndex] = JSON.parse(JSON.stringify(savedExercise));
            renderExercises();
            loadPreviousSetsForExercise(exercisesData[tempIndex]);
        }
        return true;
    } catch (err) {
        console.error('Error saving exercise:', err);
        alert('Failed to save exercise');
        return false;
    }
}

window.selectExercise = function(exerciseName) {
    const modal = document.getElementById('exercise-picker-modal');

    // Check if we're replacing an existing exercise
    const replaceIndex = modal.dataset.replaceIndex;

    // Add to active workout
    if (activeWorkout && exerciseName) {
        if (replaceIndex !== undefined) {
            // Replace existing exercise
            const index = parseInt(replaceIndex);
            if (index >= 0 && index < exercisesData.length) {
                // Get the existing sets from the exercise being replaced
                const existingSets = exercisesData[index].sets || [];
                
                // Create new exercise with existing sets
                const newExerciseWithSets = {
                    id: null,
                    workout_id: activeWorkout.id,
                    name: exerciseName,
                    order: index + 1, // Keep same order
                    sets: existingSets.length > 0 ? [...existingSets] : []
                };
                
                // Replace in local state
                exercisesData[index] = newExerciseWithSets;
                
                // Save to backend, keeping the sets
                saveExerciseToBackend(newExerciseWithSets, true)
                    .then(saved => {
                        exercisesData[index] = saved;
                        renderExercises();
                        hideExercisePicker();
                        loadPreviousSetsForExercise(exercisesData[index]);
                    })
                    .catch(err => {
                        console.error('Error saving replacement:', err);
                        alert('Failed to save exercise');
                    });
            }
        } else {
            addExerciseByName(exerciseName);
        }
    }

    hideExercisePicker();
};

// Save exercise to backend
async function saveExerciseToBackend(exercise, keepSets = false) {
    // Build exercise payload with sets if we want to preserve them
    const exercisePayload = {
        name: exercise.name,
        order: exercise.order
    };
    
    // If keeping sets and they exist, include them in the payload
    if (keepSets && exercise.sets && exercise.sets.length > 0) {
        exercisePayload.sets = exercise.sets.map(s => ({
            order: s.order,
            reps: s.reps,
            weight_kg: s.weight_kg,
            to_failure: s.to_failure || false
        }));
    }
    
    // Update the workout with exercise
    await api.patch(`/workouts/${activeWorkout.id}`, {
        exercises: [exercisePayload]
    });
    
    // Get updated workout with all exercises and their IDs
    const updatedWorkout = await api.get(`/workouts/${activeWorkout.id}`);
    
    // Find the exercise we just added/updated by name and order
    const savedExercise = updatedWorkout.exercises.find(ex => 
        ex.name === exercise.name && ex.order === exercise.order
    );
    
    // Return a deep copy of sets to avoid reference issues
    const returnedSets = keepSets && exercise.sets ? JSON.parse(JSON.stringify(exercise.sets)) : [];
    
    return {
        id: savedExercise ? savedExercise.id : null,
        workout_id: activeWorkout.id,
        name: exercise.name,
        order: exercise.order,
        sets: returnedSets
    };
}

    // Render exercises for active workout
    function renderExercises() {
        const container = document.getElementById('workout-exercises');
        
        if (exercisesData.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center;">No exercises yet. Click "+ Add Exercise" to add one.</p>';
            return;
        }
        
        // Read-only detail view (viewing a finished workout, not editing it)
        const isLocked = activeWorkout && activeWorkout.readOnly === true;
        
        container.innerHTML = exercisesData.map((exercise, exIndex) => {
            // Create a unique identifier for the tbody to avoid ID conflicts when exercises are added/replaced
            const tbodyId = `sets-${exIndex}`;
            const canMoveUp = exIndex > 0;
            const canMoveDown = exIndex < exercisesData.length - 1;
            return `
        <div class="card" data-exercise-id="${exercise.id || 'temp'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}" data-internal-index="${exIndex}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${exercise.name}</strong>
                    ${!exercise.id ? '<span style="font-size: 0.8rem; color: #888;">(unsaved)</span>' : ''}
                </div>
                ${isLocked ? '' : `
                    <div style="display: flex; gap: 0.1rem;">
                        <button onclick="moveExercise(${exIndex}, -1)" title="Move up" ${canMoveUp ? '' : 'disabled'} style="background: none; border: none; cursor: ${canMoveUp ? 'pointer' : 'default'}; padding: 0.25rem; font-size: 1rem; opacity: ${canMoveUp ? '1' : '0.3'};">▲</button>
                        <button onclick="moveExercise(${exIndex}, 1)" title="Move down" ${canMoveDown ? '' : 'disabled'} style="background: none; border: none; cursor: ${canMoveDown ? 'pointer' : 'default'}; padding: 0.25rem; font-size: 1rem; opacity: ${canMoveDown ? '1' : '0.3'};">▼</button>
                        <button onclick="replaceExercise(${exIndex})" title="Replace exercise" style="background: none; border: none; cursor: pointer; padding: 0.25rem; font-size: 1rem;">🔄</button>
                        <button onclick="removeExercise(${exIndex})" title="Remove exercise" style="background: none; border: none; cursor: pointer; padding: 0.25rem; color: #dc3545; font-size: 1rem;">🗑️</button>
                    </div>
                `}
            </div>
            
            <table class="set-table" style="width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.85rem;">
                <thead>
                    <tr style="border-bottom: 1px solid #eee;">
                        <th style="text-align: left; padding: 0.5rem; width: 12%;">Set</th>
                        <th style="text-align: left; padding: 0.5rem; width: 12%;">Previous</th>
                        <th style="text-align: left; padding: 0.5rem; width: 20%;">kg</th>
                        <th style="text-align: left; padding: 0.5rem; width: 20%;">Reps</th>
                        <th style="text-align: center; padding: 0.5rem; width: 12%;">F</th>
                        <th style="text-align: center; padding: 0.5rem; width: 12%;">🗑️</th>
                    </tr>
                </thead>
                <tbody id="${tbodyId}">
                    ${renderSetRows(exercise, exIndex)}
                </tbody>
            </table>
            
            <div style="margin-top: 0.5rem;">
                ${isLocked
                    ? ''
                    : `<button class="btn btn-secondary add-set-btn" style="font-size: 0.85rem; padding: 0.5rem; background: #1a1a2e !important;" data-exercise-index="${exIndex}">
                        + Add Set
                    </button>`}
            </div>
        </div>
    `}).join('');
        
        // Update finish button visibility based on lock state
        const finishBtn = document.getElementById('finish-workout');
        if (isLocked && finishBtn) {
            finishBtn.style.display = 'none';
        } else if (!isLocked && finishBtn) {
            finishBtn.style.display = 'block';
        }
    }

// Sync input values to state - called on every input change
window.syncSetInputToState = function(exerciseIndex, setIndex, field, value) {
    const exercise = exercisesData[exerciseIndex];
    if (!exercise || !exercise.sets) return;
    
    const set = exercise.sets[setIndex];
    if (!set) return;
    
    // Convert value to proper type
    if (field === 'weight_kg' || field === 'reps') {
        set[field] = value !== '' ? (field === 'weight_kg' ? parseFloat(value) : parseInt(value)) : null;
    } else if (field === 'completed') {
        set.completed = value;
    }
};

    // Render set rows for a given exercise
function renderSetRows(exercise, exIndex) {
    const sets = exercise.sets || [];
    
    if (sets.length === 0) {
        return '<tr><td colspan="6" style="text-align: center; color: #999; padding: 0.5rem;">No sets added yet</td></tr>';
    }
    
    // Read-only detail view (viewing a finished workout, not editing it)
    const isLocked = activeWorkout && activeWorkout.readOnly === true;

    // Sets are always numbered sequentially 1, 2, 3... based on position
    return sets.map((set, setIndex) => {
        const weightVal = set.weight_kg !== null ? set.weight_kg : '';
        const repsVal = set.reps !== null ? set.reps : '';
        const hasHold = set.hold_seconds !== null && set.hold_seconds !== undefined && set.hold_seconds !== '';
        const repsDisplay = hasHold
            ? (repsVal !== '' ? `${repsVal} reps · ${set.hold_seconds}s hold` : `${set.hold_seconds}s hold`)
            : (repsVal !== '' ? `${repsVal} reps` : '');

        // Reference-only "last time" value for this set position - never overwrites current inputs
        const previousText = exercise.previousSets ? formatPreviousSet(exercise.previousSets[setIndex]) : null;
        const previousDisplay = previousText || '—';

        // For active workouts: show inputs + checkbox + bin icon
        if (!isLocked) {
            return `
            <tr data-set-id="${set.id || 'temp-set-' + (setIndex + 1)}" class="${set.completed ? 'completed-set' : ''}">
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                    <span style="color: ${set.completed ? '#28a745' : '#666'}; font-weight: ${set.completed ? 'bold' : 'normal'};">Set ${setIndex + 1}</span>
                </td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                    <span style="color: #999;">${previousDisplay}</span>
                </td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                    <input type="number" class="set-weight" data-set-index="${setIndex}" value="${weightVal}" placeholder="kg" min="0" step="0.5" style="width: 100%; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;" oninput="syncSetInputToState(${exIndex}, ${setIndex}, 'weight_kg', this.value)">
                </td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                    <input type="number" class="set-reps" data-set-index="${setIndex}" value="${repsVal}" placeholder="reps" min="1" style="width: 100%; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;" oninput="syncSetInputToState(${exIndex}, ${setIndex}, 'reps', this.value)">
                </td>
                 <td style="padding: 0.5rem; border-bottom: 1px solid #eee; text-align: center;">
                    <button type="button" class="set-failure-toggle" title="Mark set as taken to failure" onclick="toggleSetFailure(${exIndex}, ${setIndex}, this)" style="width: 26px; height: 26px; border-radius: 4px; border: 1px solid ${set.to_failure ? '#dc3545' : '#ccc'}; background: ${set.to_failure ? '#dc3545' : 'transparent'}; color: ${set.to_failure ? '#fff' : '#999'}; font-family: monospace; font-weight: bold; line-height: 1; cursor: pointer;">F</button>
                </td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee; text-align: center;">
                    <button onclick="removeSet(${exIndex}, ${setIndex})" style="background: none; border: none; cursor: pointer; padding: 0.25rem; color: #dc3545;">🗑️</button>
                </td>
            </tr>
        `;
        }
        
        // For locked (finished) workouts: show values only, no bin icon
        return `
        <tr data-set-id="${set.id || 'temp-set-' + (setIndex + 1)}" class="${set.completed ? 'completed-set' : ''}">
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                <span style="color: ${set.completed ? '#28a745' : '#666'}; font-weight: ${set.completed ? 'bold' : 'normal'};">Set ${setIndex + 1}</span>
            </td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                <span style="color: #999;">${previousDisplay}</span>
            </td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;"><span style="color: #666;">${weightVal !== '' ? weightVal + 'kg' : ''}</span></td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;"><span style="color: #666;">${repsDisplay}</span></td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;"></td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;"></td>
        </tr>
    `;
    }).join('');
}

// Add new set - immediately creates a permanent set in local state
window.showAddSetForm = function(exerciseIndex) {
    const exercise = exercisesData[exerciseIndex];
    
    if (!exercise) {
        return;
    }
    
    // Add new set to local state
    const newSet = {
        order: (exercise.sets ? exercise.sets.length : 0) + 1,
        reps: null,
        weight_kg: null,
        completed: false,
        to_failure: false
    };
    
    if (!exercise.sets) exercise.sets = [];
    exercise.sets.push(newSet);
    
    // Re-render all exercises
    renderExercises();
};

// Toggle "to failure" flag for a set - persisted with the workout
window.toggleSetFailure = function(exerciseIndex, setIndex, btn) {
    const exercise = exercisesData[exerciseIndex];
    if (!exercise || !exercise.sets || !exercise.sets[setIndex]) return;

    const newValue = !exercise.sets[setIndex].to_failure;
    exercise.sets[setIndex].to_failure = newValue;

    if (newValue) {
        btn.style.background = '#dc3545';
        btn.style.borderColor = '#dc3545';
        btn.style.color = '#fff';
    } else {
        btn.style.background = 'transparent';
        btn.style.borderColor = '#ccc';
        btn.style.color = '#999';
    }
};

// Save set (update individual weight/reps)
window.saveSet = async function(exerciseIndex, setIndex) {
    const exercise = exercisesData[exerciseIndex];
    
    if (!exercise || !exercise.id) {
        return;
    }
    
    // Find the row using querySelector on tbody by finding the setIndex-th row
    const exerciseRow = document.querySelector(`[data-exercise-id="${exercise.id || 'temp-' + exerciseIndex}"]`);
    if (!exerciseRow) {
        console.error('Could not find exercise row for set saving');
        return;
    }
    
    const tbody = exerciseRow.querySelector('tbody');
    if (!tbody) {
        console.error('Could not find tbody in exercise row');
        return;
    }
    
    // Get all rows and select the one at setIndex
    const allRows = tbody.querySelectorAll('tr');
    if (setIndex >= allRows.length) {
        console.error('setIndex', setIndex, 'out of range for', allRows.length, 'rows');
        return;
    }
    
    const row = allRows[setIndex];
    if (!row) {
        console.error('Could not find row at setIndex:', setIndex);
        return;
    }
    
    const weightInput = row.querySelector('.set-weight');
    const repsInput = row.querySelector('.set-reps');
    
    if (!weightInput || !repsInput) {
        console.error('Could not find input fields in row');
        return;
    }
    
    const weight_kg = weightInput.value ? parseFloat(weightInput.value) : null;
    const reps = repsInput.value ? parseInt(repsInput.value) : null;
    
    // Get current workout details from backend
    try {
        const workoutDetail = await api.get(`/workouts/${activeWorkout.id}`);
        
        // Build the update payload
        const exercisesUpdate = workoutDetail.exercises.map((ex, idx) => ({
            id: ex.id,
            name: ex.name,
            order: ex.order,
            sets: (ex.sets || []).map((s, sIdx) => {
                if (idx === exerciseIndex && sIdx === setIndex) {
                    return {
                        id: s.id,
                        order: s.order,
                        weight_kg: weight_kg !== null ? weight_kg : s.weight_kg,
                        reps: reps !== null ? reps : s.reps
                    };
                }
                return { id: s.id, order: s.order, weight_kg: s.weight_kg, reps: s.reps };
            })
        }));
        
        // Update workout with new set values
        await api.patch(`/workouts/${activeWorkout.id}`, {
            exercises: exercisesUpdate,
            notes: workoutDetail.notes
        });
        
        // Debug logging
    console.log('=== saveSet local state update ===');
    console.log('workoutDetail.exercises[', exerciseIndex, '].sets = ', workoutDetail.exercises[exerciseIndex].sets);
    
    // Update local state with saved data
    exercisesData[exerciseIndex].sets = workoutDetail.exercises[exerciseIndex].sets.map((s, sIdx) => {
        if (sIdx === setIndex) {
            console.log(`Updating set ${setIndex}: weight_kg=${weight_kg}, reps=${reps}`);
            return { ...s, weight_kg: weight_kg !== null ? weight_kg : s.weight_kg, reps: reps !== null ? reps : s.reps };
        }
        console.log(`Preserving set ${sIdx}:`, JSON.parse(JSON.stringify(s)));
        return s;
    });
    console.log('exercisesData[', exerciseIndex, '].sets after update:', exercisesData[exerciseIndex].sets);
        
    } catch (error) {
        console.error('Error saving set:', error);
        alert('Failed to save set');
    }
};

// Cancel new set
window.cancelNewSet = function(btn) {
    btn.closest('tr').remove();
};

// Remove exercise from workout, identified reliably by its unique id (not just render position)
window.removeExercise = async function(exerciseIndex) {
    const exercise = exercisesData[exerciseIndex];

    if (!exercise) {
        console.log('Exercise not found at index:', exerciseIndex);
        return;
    }

    if (!confirm(`Remove "${exercise.name}" from this workout?`)) return;

    // Unsaved/temp exercise (no id yet) - nothing persisted, just drop from local state
    if (!exercise.id) {
        const tempIdx = exercisesData.indexOf(exercise);
        if (tempIdx !== -1) exercisesData.splice(tempIdx, 1);
        renderExercises();
        return;
    }

    // Saved exercise - delete it from the backend by its unique id first,
    // so the removal persists (and its sets don't silently reappear later)
    try {
        await api.delete(`/workouts/${activeWorkout.id}/exercises/${exercise.id}`);
    } catch (err) {
        console.error('Error removing exercise:', err);
        alert('Failed to remove exercise');
        return;
    }

    // Re-find by unique id rather than trusting the captured index, in case
    // the array shifted between the click and the delete request resolving
    const idx = exercisesData.findIndex(ex => ex.id === exercise.id);
    if (idx !== -1) exercisesData.splice(idx, 1);
    renderExercises();
};

// Move an exercise up (direction -1) or down (direction 1) in the active workout
window.moveExercise = async function(exerciseIndex, direction) {
    const newIndex = exerciseIndex + direction;
    if (newIndex < 0 || newIndex >= exercisesData.length) return;

    // Swap in local state
    const temp = exercisesData[exerciseIndex];
    exercisesData[exerciseIndex] = exercisesData[newIndex];
    exercisesData[newIndex] = temp;

    // Reassign sequential order values to match the new array positions
    exercisesData.forEach((ex, i) => { ex.order = i + 1; });

    renderExercises();

    // Persist the new order for exercises already saved to the backend
    if (!activeWorkout || !activeWorkout.id) return;

    const exercisesPayload = exercisesData
        .filter((ex) => ex.id)
        .map((ex) => ({
            id: ex.id,
            name: ex.name,
            order: ex.order,
            sets: (ex.sets || []).map((set) => ({
                id: set.id,
                order: set.order,
                reps: set.reps,
                weight_kg: set.weight_kg,
                hold_seconds: set.hold_seconds,
                to_failure: set.to_failure,
                rest_seconds: set.rest_seconds,
                note: set.note
            }))
        }));

    if (exercisesPayload.length === 0) return;

    try {
        await api.patch(`/workouts/${activeWorkout.id}`, { exercises: exercisesPayload });
    } catch (error) {
        console.error('Error saving exercise order:', error);
    }
};

// Replace exercise in workout
window.replaceExercise = function(exerciseIndex) {
    showExercisePicker();
    
    // Store which exercise to replace (in case modal was just created)
    const modal = document.getElementById('exercise-picker-modal');
    if (modal) {
        modal.dataset.replaceIndex = exerciseIndex;
        
        currentExerciseNameFilter = '';
        document.querySelector('#exercise-picker-modal input').value = '';
        renderExerciseList();
    }
};

// Remove set using bin button (frontend only - no backend calls)
window.removeSet = function(exerciseIndex, setIndex) {
    // Get exercise from the global array using index
    const exercise = exercisesData[exerciseIndex];
    
    if (!exercise) {
        console.error('Exercise not found at index:', exerciseIndex);
        return;
    }
    
    // Find the tbody by its index-based ID
    const tbodyId = `sets-${exerciseIndex}`;
    const tbody = document.getElementById(tbodyId);
    
    if (!tbody) {
        console.error('Could not find tbody with ID:', tbodyId);
        return;
    }
    
    const allRows = tbody.querySelectorAll('tr');
    if (setIndex >= allRows.length) return;
    
    const rowToRemove = allRows[setIndex];
    rowToRemove.remove();
    
    // Remove from local state
    if (exercise.sets && setIndex < exercise.sets.length) {
        exercise.sets.splice(setIndex, 1);
    }
    
    // Renumber remaining sets to keep sequential numbering
    renumberSets(exerciseIndex);
};

// Renumber all sets for an exercise to keep sequential numbering
function renumberSets(exerciseIndex) {
    const exercise = exercisesData[exerciseIndex];
    if (!exercise) return;
    
    // Find tbody by its index-based ID
    const tbodyId = `sets-${exerciseIndex}`;
    const tbody = document.getElementById(tbodyId);
    
    if (!tbody) {
        console.error('Could not find tbody with ID:', tbodyId);
        return;
    }
    
    // Get all current rows and update their set numbers
    const allRows = tbody.querySelectorAll('tr');
    allRows.forEach((row, newIndex) => {
        const setNumSpan = row.querySelector('td:first-child span');
        if (setNumSpan) {
            setNumSpan.textContent = `Set ${newIndex + 1}`;
        }
    });
    
    // Also update local state set orders
    if (exercise.sets) {
        exercise.sets.forEach((set, sIdx) => {
            if (sIdx < allRows.length) {
                set.order = sIdx + 1;
            }
        });
    }
}

// Start a blank active workout (the original "Start Workout" behaviour,
// now one of the choices on the start-workout screen).
async function startEmptyWorkout() {
    try {
        const workout = await api.post('/workouts', { notes: 'My workout' });

        activeWorkout = {
            id: workout.id,
            started_at: workout.started_at
        };

        // Show active workout section, hide start button
        document.getElementById('start-workout-section').style.display = 'none';
        document.getElementById('active-workout-section').style.display = 'block';

        // Set active workout ID display
        document.getElementById('active-workout-id').textContent = `Workout #${workout.id}`;

        // Start the timer, anchored to the server-recorded start time
        timer.start(activeWorkout.started_at);

        // Reset exercises data for new workout - ensure we have a NEW array, not just empty
        if (exercisesData === null || exercisesData === undefined) {
            exercisesData = [];
        } else {
            exercisesData.length = 0; // Clear existing array
        }

        renderExercises();

        // Ensure finish button is enabled for new workout
        const finishBtn = document.getElementById('finish-workout');
        if (finishBtn) {
            finishBtn.textContent = 'Finish';
            finishBtn.disabled = false;
            finishBtn.style.opacity = '1';
        }
    } catch (error) {
        console.error('Error starting workout:', error);
        alert('Failed to start workout');
    }
}

// Start-workout choice screen: "Empty Workout" (current behaviour) vs.
// "Recommended Workout" (suggested exercises, reviewed before starting).
function showStartWorkoutChoice() {
    const modal = document.createElement('div');
    modal.id = 'start-workout-choice-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 400px;
        padding: 1.25rem;
    `;

    content.innerHTML = `
        <h3 style="margin-bottom: 1rem;">Start Workout</h3>
        <div id="choice-empty-workout" class="card" style="cursor: pointer; margin-bottom: 0.75rem;">
            <strong>Empty Workout</strong>
            <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">Start a blank workout and add exercises as you go.</div>
        </div>
        <div id="choice-recommended-workout" class="card" style="cursor: pointer; margin-bottom: 1rem;">
            <strong>Recommended Workout</strong>
            <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">Get a suggested workout to review before starting.</div>
        </div>
        <button id="choice-cancel-btn" class="btn btn-secondary" style="width: 100%;">Cancel</button>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('choice-empty-workout').onclick = () => {
        modal.remove();
        startEmptyWorkout();
    };
    document.getElementById('choice-recommended-workout').onclick = () => {
        modal.remove();
        showSplitChoice();
    };
    document.getElementById('choice-cancel-btn').onclick = () => modal.remove();
}

// Upper/lower choice screen, shown after picking "Recommended Workout" -
// every suggestion is all-upper or all-lower, so the user picks which.
function showSplitChoice() {
    const modal = document.createElement('div');
    modal.id = 'split-choice-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 400px;
        padding: 1.25rem;
    `;

    content.innerHTML = `
        <h3 style="margin-bottom: 1rem;">Recommended Workout</h3>
        <div id="choice-upper-body" class="card" style="cursor: pointer; margin-bottom: 0.75rem; text-align: center;">
            <strong>Upper Body</strong>
        </div>
        <div id="choice-lower-body" class="card" style="cursor: pointer; margin-bottom: 1rem; text-align: center;">
            <strong>Lower Body</strong>
        </div>
        <button id="split-back-btn" class="btn btn-secondary" style="width: 100%;">Back</button>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('choice-upper-body').onclick = () => {
        modal.remove();
        showRecommendedWorkoutReview('upper');
    };
    document.getElementById('choice-lower-body').onclick = () => {
        modal.remove();
        showRecommendedWorkoutReview('lower');
    };
    document.getElementById('split-back-btn').onclick = () => {
        modal.remove();
        showStartWorkoutChoice();
    };
}

// Fetch a proposed workout for the given split and show it on the review screen.
async function showRecommendedWorkoutReview(split) {
    let suggestion;
    try {
        suggestion = await api.get(`/suggest-workout?split=${split}`);
    } catch (error) {
        console.error('Error fetching workout suggestion:', error);
        alert('Failed to get a recommended workout');
        showSplitChoice();
        return;
    }
    renderRecommendedWorkoutModal(suggestion, split);
}

// Review screen for a proposed workout: each exercise with its reason,
// plus Start this workout / Shuffle / Back.
function renderRecommendedWorkoutModal(suggestion, split) {
    let modal = document.getElementById('recommended-workout-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'recommended-workout-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        document.body.appendChild(modal);
    }

    const rows = suggestion.map(ex => `
        <div class="card" style="margin-bottom: 0.5rem;">
            <strong>${ex.name}</strong>
            <div style="font-size: 0.8rem; color: #888; margin-top: 0.15rem;">${ex.muscle_group}</div>
            <div style="font-size: 0.85rem; color: #e94560; margin-top: 0.25rem;">${ex.reason}</div>
        </div>
    `).join('');

    const splitLabel = split === 'lower' ? 'Lower Body' : 'Upper Body';

    modal.innerHTML = `
        <div style="background: white; border-radius: 12px; width: 90%; max-width: 400px; max-height: 80vh; display: flex; flex-direction: column;">
            <div style="padding: 1rem; border-bottom: 1px solid #eee;">
                <h3>Recommended Workout — ${splitLabel}</h3>
            </div>
            <div style="padding: 0.75rem 1rem; overflow-y: auto; flex: 1;">
                ${rows || '<p style="text-align: center; color: #888;">No suggestion available yet - log a few exercises first.</p>'}
            </div>
            <div style="padding: 1rem; border-top: 1px solid #eee;">
                <button id="recommended-start-btn" class="btn" style="width: 100%; margin-bottom: 0.5rem;">Start this workout</button>
                <button id="recommended-shuffle-btn" class="btn btn-secondary" style="width: 100%; margin-bottom: 0.5rem;">Shuffle</button>
                <button id="recommended-back-btn" class="btn btn-secondary" style="width: 100%;">Back</button>
            </div>
        </div>
    `;

    document.getElementById('recommended-start-btn').onclick = () => startRecommendedWorkout(suggestion, modal);
    document.getElementById('recommended-shuffle-btn').onclick = async () => {
        try {
            const nextSuggestion = await api.get(`/suggest-workout?split=${split}`);
            renderRecommendedWorkoutModal(nextSuggestion, split);
        } catch (error) {
            console.error('Error shuffling workout suggestion:', error);
            alert('Failed to get a new suggestion');
        }
    };
    document.getElementById('recommended-back-btn').onclick = () => {
        modal.remove();
        showSplitChoice();
    };
}

// "Start this workout": opens a new active workout, then adds each
// proposed exercise the same way the exercise picker does (sequentially,
// since each add persists to the backend and reads back the current list).
async function startRecommendedWorkout(suggestion, modal) {
    modal.remove();
    await startEmptyWorkout();
    if (!activeWorkout) return; // startEmptyWorkout already alerted on failure
    for (const ex of suggestion) {
        await addExerciseByName(ex.name);
    }
}

// Initialize workout on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Fitness Tracker App initialized');
    
    // Initialize tabs
    initTabs();

    // Load persisted custom exercise names for the exercise picker
    loadCustomExercises();
    loadLoggedExerciseNames();
    loadKneeExercises();

    // Add-exercise controls for the knee-strengthening list
    const kneeAddBtn = document.getElementById('knee-exercise-add-btn');
    const kneeInput = document.getElementById('knee-exercise-input');
    if (kneeAddBtn && kneeInput) {
        const addKneeExercise = async () => {
            const name = kneeInput.value.trim();
            if (!name) return;
            try {
                await api.post('/knee-exercises', { name });
                kneeInput.value = '';
                loadKneeExercises();
            } catch (error) {
                console.error('Error adding knee exercise:', error);
                alert('Failed to add exercise');
            }
        };
        kneeAddBtn.addEventListener('click', addKneeExercise);
        kneeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addKneeExercise();
        });
    }

    // Initialize food photo analysis functionality
    if (typeof foodPhoto !== 'undefined' && foodPhoto.init) {
        foodPhoto.init();
    }

    // Initialize manual food search functionality
    if (typeof foodSearch !== 'undefined' && foodSearch.init) {
        foodSearch.init();
    }

    // Initialize weekly check-in functionality
    if (typeof checkin !== 'undefined' && checkin.init) {
        checkin.init();
    }

    // Initialize Today's Overview (default active tab, so load right away)
    if (typeof today !== 'undefined' && today.init) {
        today.init();
    }

    // Initialize the Progress tab (charts load lazily on tab switch)
    if (typeof progress !== 'undefined' && progress.init) {
        progress.init();
    }

    // Start new workout button: opens the choice screen (Empty vs. Recommended)
    // instead of starting a blank workout directly.
    const startWorkoutBtn = document.getElementById('start-new-workout');
    if (startWorkoutBtn) {
        startWorkoutBtn.addEventListener('click', () => {
            showStartWorkoutChoice();
        });
    }
    
    // Finish workout button
    const finishWorkoutBtn = document.getElementById('finish-workout');
    if (finishWorkoutBtn) {
        finishWorkoutBtn.addEventListener('click', async () => {
            if (!activeWorkout) return;

            // Editing a past (already finished) workout: persist the edits
            // without touching finished_at/duration_seconds or the timer.
            if (activeWorkout.isPastEdit) {
                try {
                    const nameInput = document.getElementById('workout-name-input');
                    const exercisesPayload = exercisesData.map(ex => ({
                        id: ex.id,
                        name: ex.name,
                        order: ex.order,
                        sets: (ex.sets || []).map(set => ({
                            id: set.id,
                            order: set.order,
                            reps: set.reps,
                            weight_kg: set.weight_kg,
                            hold_seconds: set.hold_seconds,
                            to_failure: set.to_failure,
                            rest_seconds: set.rest_seconds,
                            note: set.note
                        }))
                    }));

                    await api.patch(`/workouts/${activeWorkout.id}`, {
                        notes: nameInput ? nameInput.value.trim() : undefined,
                        exercises: exercisesPayload
                    });

                    activeWorkout = null;
                    exercisesData = [];

                    document.getElementById('active-workout-section').style.display = 'none';
                    document.getElementById('start-workout-section').style.display = 'block';

                    alert('Workout updated!');

                    loadWorkouts();
                    if (typeof today !== 'undefined') today.loadToday();
                } catch (error) {
                    console.error('Error saving workout edits:', error);
                    alert('Failed to save changes');
                }
                return;
            }

            try {
                // Stop the timer
                timer.stop();

                // Count unchecked sets before filtering
                let uncheckedCount = 0;
                exercisesData.forEach(ex => {
                    (ex.sets || []).forEach(set => {
                        if (!set.completed) uncheckedCount++;
                    });
                });

                // Save ALL sets - not just completed ones
                const nameInput = document.getElementById('workout-name-input');
                const exercisesPayload = exercisesData.map(ex => ({
                    id: ex.id,
                    name: ex.name,
                    order: ex.order,
                    sets: (ex.sets || []).map(set => ({
                        id: set.id,
                        order: set.order,
                        reps: set.reps,
                        weight_kg: set.weight_kg,
                        hold_seconds: set.hold_seconds,
                        to_failure: set.to_failure,
                        rest_seconds: set.rest_seconds,
                        note: set.note
                    }))
                }));

                // Update workout with finish info and filtered sets
                const finishedAt = new Date().toISOString();
                await api.patch(`/workouts/${activeWorkout.id}`, {
                    finished_at: finishedAt,
                    notes: nameInput ? nameInput.value.trim() : undefined,
                    exercises: exercisesPayload
                });

                // Read the final elapsed time BEFORE resetting - timer.reset()
                // zeroes it, so building this message after reset() always
                // read back "00:00" regardless of how long the workout ran.
                const finalDuration = timer.getFormattedTime();

                // Reset active workout state
                activeWorkout = null;
                exercisesData = [];

                // Hide active workout section, show start button
                document.getElementById('active-workout-section').style.display = 'none';
                document.getElementById('start-workout-section').style.display = 'block';

                // Reset timer
                timer.reset();

                let message = `Workout finished! Duration: ${finalDuration}\n\nAll sets have been saved. You can edit past workouts using the "Edit" button in the History tab.`;

                alert(message);

                // Reload workouts list
                loadWorkouts();
                if (typeof today !== 'undefined') today.loadToday();

            } catch (error) {
                console.error('Error finishing workout:', error);
                alert('Failed to finish workout');
            }
        });
    }
    
    // Add exercise button - shows picker
    const addExerciseBtn = document.getElementById('start-new-exercise');
    if (addExerciseBtn) {
        addExerciseBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Add exercise button clicked via', this.tagName, this.id);
            showExercisePicker();
        });
    }
    
    // Event delegation for "Add Set" buttons
    document.addEventListener('click', (e) => {
        if (e.target.matches('.add-set-btn')) {
            const exerciseIndex = parseInt(e.target.dataset.exerciseIndex);
            showAddSetForm(exerciseIndex);
        }
    });
    
    // Format date as "Monday, 3 Aug"
    function formatDate(date) {
        return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
    }
    
    // Format date as "Monday, 3 Aug" with year
    function formatDateWithYear(date) {
        return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    }
    
    // Get month group header (e.g., "AUGUST 2026")
    function getMonthHeader(date) {
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
    }
    
    // Calculate total weight lifted (sum of weight_kg × reps across all sets)
    function calculateTotalWeight(workout) {
        let total = 0;
        if (workout.exercises && workout.exercises.length > 0) {
            workout.exercises.forEach(ex => {
                if (ex.sets && ex.sets.length > 0) {
                    ex.sets.forEach(set => {
                        if (set.weight_kg !== null && set.reps !== null) {
                            total += set.weight_kg * set.reps;
                        }
                    });
                }
            });
        }
        return total;
    }
    
    // Format duration from seconds
    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '—';
        const totalSeconds = Math.round(seconds);
        
        // If under 60 seconds, show seconds
        if (totalSeconds < 60) {
            return `${totalSeconds}s`;
        }
        
        const mins = Math.floor(totalSeconds / 60);
        if (mins < 60) {
            return `${mins}m`;
        }
        
        const hours = Math.floor(mins / 60);
        const remainingMins = mins % 60;
        return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
    }
    
    // Get best set for an exercise (highest weight)
    function getBestSet(exercise) {
        if (!exercise.sets || exercise.sets.length === 0) return null;
        
        let bestSet = null;
        let maxWeight = -1;
        
        exercise.sets.forEach(set => {
            if (set.weight_kg !== null && set.weight_kg > maxWeight) {
                maxWeight = set.weight_kg;
                bestSet = set;
            }
        });
        
        return bestSet;
    }
    
    // Format a set for display
    function formatSet(set) {
        if (!set) return '';
        
        const hasHold = set.hold_seconds !== null && set.hold_seconds !== undefined && set.hold_seconds !== '';
        
        if (hasHold) {
            return `${set.weight_kg} kg × ${set.hold_seconds}s hold`;
        }
        
        const repsDisplay = set.reps !== null ? `${set.reps} reps` : '';
        return set.weight_kg !== null 
            ? `${set.weight_kg} kg × ${repsDisplay}`.trim() 
            : (repsDisplay ? repsDisplay : '');
    }
    
    // Load workouts when clicking Workout tab
    window.loadWorkouts = async () => {
        const workoutList = document.getElementById('workout-list');
        
        if (!workoutList) return;
        
        try {
            const workouts = await api.get('/workouts');
            
            if (workouts.length === 0) {
                workoutList.innerHTML = '<div class="empty-state">No workouts logged yet.</div>';
                return;
            }
            
            // Group workouts by month
            const months = {};
            workouts.forEach(workout => {
                const date = new Date(workout.started_at);
                const monthKey = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toLowerCase();
                const monthHeader = getMonthHeader(date);
                
                if (!months[monthKey]) {
                    months[monthKey] = { header: monthHeader, workouts: [] };
                }
                months[monthKey].workouts.push(workout);
            });
            
            // Render with month grouping
            let html = '';
            const sortedKeys = Object.keys(months).sort((a, b) => {
                // Sort by date descending (most recent first)
                const dateA = new Date(months[a].workouts[0].started_at);
                const dateB = new Date(months[b].workouts[0].started_at);
                return dateB - dateA;
            });
            
            sortedKeys.forEach(monthKey => {
                const monthData = months[monthKey];
                
                html += `<div class="history-month-header">${monthData.header}</div>`;
                
                monthData.workouts.forEach(workout => {
                    const date = new Date(workout.started_at);
                    const workoutName = (workout.name && workout.name.trim() !== '') 
                        ? workout.name 
                        : `Workout #${workout.id}`;
                    const totalWeight = calculateTotalWeight(workout);
                    
                    // Build mini exercises table
                    let exercisesHtml = '';
                    if (workout.exercises && workout.exercises.length > 0) {
                        workout.exercises.forEach(ex => {
                            const bestSet = getBestSet(ex);
                            const setCount = ex.sets ? ex.sets.length : 0;
                            exercisesHtml += `
                                <tr>
                                    <td>${setCount} × ${ex.name}</td>
                                    <td style="white-space: nowrap;">${bestSet ? formatSet(bestSet) : '-'}</td>
                                </tr>
                            `;
                        });
                    } else {
                        exercisesHtml = '<tr><td colspan="2" style="text-align: center; color: #999;">No exercises</td></tr>';
                    }
                    
                    html += `
                        <div class="history-card" onclick="showHistoryDetail(${workout.id})">
                            <div class="history-card-header">
                                <span class="history-card-name">${workoutName}</span>
                                <button class="history-menu-btn" onclick="event.stopPropagation(); showWorkoutMenu(${workout.id}, event)">
                                    …
                                </button>
                            </div>
                            <div class="history-card-date">${formatDate(date)}</div>
                            <div class="history-stats">
                                <span class="history-stat" title="Duration">
                                    <span class="history-stat-icon">⏱️</span>
                                    ${formatDuration(workout.duration_seconds)}
                                </span>
                                <span class="history-stat" title="Total weight lifted">
                                    <span class="history-stat-icon">🏋️</span>
                                    ${totalWeight > 0 ? `${totalWeight} kg` : '—'}
                                </span>
                            </div>
                            <table class="history-exercises-table">
                                <thead>
                                    <tr>
                                        <th style="width: 60%;">Exercise</th>
                                        <th>Best Set</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${exercisesHtml}
                                </tbody>
                            </table>
                        </div>
                    `;
                });
            });
            
            workoutList.innerHTML = html;
            
        } catch (error) {
            console.error('Error loading workouts:', error);
            workoutList.innerHTML = '<div class="empty-state">Failed to load workouts.</div>';
        }
    };
    
    // Open history workout detail view
    window.openHistoryWorkoutDetail = async (workoutId) => {
        try {
            const workout = await api.get(`/workouts/${workoutId}`);
            
            // Debug: Log the workout data to see what we received
            console.log('openWorkout - Workout data:', workout);
            
            activeWorkout = {
                id: workout.id,
                started_at: workout.started_at,
                finished_at: workout.finished_at,
                readOnly: workout.finished_at !== null,
                isPastEdit: false
            };

            exercisesData = workout.exercises;
            
            // Debug: Log the exercises data
            console.log('openWorkout - Exercises data:', workout.exercises);
            
            // Check if any exercise has sets
            const exercisesWithSets = workout.exercises?.filter(ex => (ex.sets || []).length > 0);
            console.log('openWorkout - Exercises with sets:', exercisesWithSets);
            
            // Debug: Show total exercises count and total sets count
            const totalExercises = workout.exercises?.length || 0;
            const totalSets = workout.exercises?.reduce((sum, ex) => sum + ((ex.sets || []).length), 0) || 0;
            console.log(`openWorkout - Total exercises: ${totalExercises}, Total sets: ${totalSets}`);

            // Hide start button, show active workout section
            document.getElementById('start-workout-section').style.display = 'none';
            document.getElementById('active-workout-section').style.display = 'block';

            // Set active workout ID display
            document.getElementById('active-workout-id').textContent = `Workout #${workout.id}`;

            // Set workout title with day/date
            const startedAt = new Date(workout.started_at);
            const dateStr = startedAt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const workoutTitle = workout.notes || `Workout #${workout.id}`;
            document.getElementById('workout-title').textContent = `${workoutTitle} - ${dateStr}`;

            // Set workout name input (for editing)
            const nameInput = document.getElementById('workout-name-input');
            if (nameInput) {
                nameInput.value = workout.notes || '';

                // Save notes when input changes
                nameInput.addEventListener('blur', async () => {
                    try {
                        await api.patch(`/workouts/${activeWorkout.id}`, {
                            notes: nameInput.value.trim()
                        });
                    } catch (error) {
                        console.error('Error saving workout name:', error);
                    }
                });
            }

            // Set timer display based on duration - always stop timer for past workouts
            if (workout.duration_seconds !== null) {
                updateTimerDisplay(workout.duration_seconds);
                timer.stop();
            } else {
                timer.stop();
                updateTimerDisplay(0);
            }

            // Disable finish button if workout is already finished
            const finishBtn = document.getElementById('finish-workout');
            finishBtn.textContent = 'Finish';
            if (workout.finished_at) {
                finishBtn.disabled = true;
                finishBtn.style.opacity = '0.5';
            } else {
                finishBtn.disabled = false;
                finishBtn.style.opacity = '1';
            }

            renderExercises();

        } catch (error) {
            console.error('Error opening workout:', error);
            alert('Failed to load workout');
        }
    };
    
    // Open a past (finished) workout in the editable interface, without
    // touching its timer or original duration. Saving PATCHes the existing
    // workout instead of finishing it.
    window.openHistoryWorkoutEdit = async (workoutId) => {
        try {
            const workout = await api.get(`/workouts/${workoutId}`);

            activeWorkout = {
                id: workout.id,
                started_at: workout.started_at,
                finished_at: workout.finished_at,
                readOnly: false,
                isPastEdit: true
            };

            exercisesData = workout.exercises;
            // These sets already happened - show them as checked off.
            exercisesData.forEach(ex => {
                (ex.sets || []).forEach(set => { set.completed = true; });
            });
            // Load "Previous" reference data (the session before this one) for each exercise
            exercisesData.forEach(ex => loadPreviousSetsForExercise(ex));

            // Hide start button, show active workout section
            document.getElementById('start-workout-section').style.display = 'none';
            document.getElementById('active-workout-section').style.display = 'block';

            // Set active workout ID display
            document.getElementById('active-workout-id').textContent = `Workout #${workout.id}`;

            // Set workout title with day/date
            const startedAt = new Date(workout.started_at);
            const dateStr = startedAt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const workoutTitle = workout.notes || `Workout #${workout.id}`;
            document.getElementById('workout-title').textContent = `${workoutTitle} - ${dateStr}`;

            // Set workout name input (for editing)
            const nameInput = document.getElementById('workout-name-input');
            if (nameInput) {
                nameInput.value = workout.notes || '';

                // Save notes when input changes
                nameInput.addEventListener('blur', async () => {
                    try {
                        await api.patch(`/workouts/${activeWorkout.id}`, {
                            notes: nameInput.value.trim()
                        });
                    } catch (error) {
                        console.error('Error saving workout name:', error);
                    }
                });
            }

            // Show the original duration - do NOT start the timer
            if (workout.duration_seconds !== null) {
                updateTimerDisplay(workout.duration_seconds);
            } else {
                updateTimerDisplay(0);
            }
            timer.stop();

            // Enable the action button in "Save" mode (persists edits, doesn't finish)
            const finishBtn = document.getElementById('finish-workout');
            if (finishBtn) {
                finishBtn.textContent = 'Save';
                finishBtn.disabled = false;
                finishBtn.style.opacity = '1';
            }

            renderExercises();

        } catch (error) {
            console.error('Error opening workout for editing:', error);
            alert('Failed to load workout');
        }
    };
    
    // Load workouts on initial page load if Workout tab is active
    if (document.querySelector('.tab.active')?.getAttribute('data-tab') === 'workout') {
        window.loadWorkouts();
    }
    
    // Close active workout (go back to list)
    window.closeActiveWorkout = function() {
        if (!activeWorkout) return;
        
        // Stop timer
        timer.stop();
        
        // Hide active workout section, show start button
        document.getElementById('active-workout-section').style.display = 'none';
        document.getElementById('start-workout-section').style.display = 'block';
        
        // Reset active workout state
        activeWorkout = null;
        exercisesData = [];
        
        // Clear timer display
        updateTimerDisplay(0);
        
        // Reset finish button state (enable it for new workouts)
        const finishBtn = document.getElementById('finish-workout');
        if (finishBtn) {
            finishBtn.textContent = 'Finish';
            finishBtn.disabled = false;
            finishBtn.style.opacity = '1';
        }

        // Clear any exercises display
        document.getElementById('workout-exercises').innerHTML = '';
    };
    
    // Go back to home/workout list (legacy)
    window.goBackToHome = function() {
        closeActiveWorkout();
    };
    
    // Show workout menu (dropdown options)
    window.showWorkoutMenu = function(workoutId, event) {
        event.stopPropagation();
        event.preventDefault();
        
        const menu = document.createElement('div');
        menu.style.cssText = `
            position: fixed;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            padding: 0.5rem;
            z-index: 1100;
            min-width: 160px;
        `;
        
        menu.innerHTML = `
            <button onclick="openHistoryWorkoutEdit(${workoutId}); this.closest('div').remove()" style="
                width: 100%;
                padding: 0.75rem;
                text-align: left;
                background: none;
                border: none;
                cursor: pointer;
                font-size: 0.9rem;
                color: #1a1a2e;
            ">Edit</button>
            <hr style="margin: 0.5rem 0; border: none; border-top: 1px solid #eee;">
            <button onclick="deleteWorkout(${workoutId}); this.closest('div').remove()" style="
                width: 100%;
                padding: 0.75rem;
                text-align: left;
                background: none;
                border: none;
                cursor: pointer;
                font-size: 0.9rem;
                color: #dc3545;
            ">Delete</button>
        `;
        
        // menu.style.position is 'fixed', which is already viewport-relative -
        // do NOT add window.scrollY/scrollX here, or the menu drifts further
        // off-screen the more the page has been scrolled.
        const rect = event.currentTarget.getBoundingClientRect();
        const top = rect.bottom;
        const left = rect.left;
        
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        
        document.body.appendChild(menu);
        
        // Close on click outside
        const closeMenu = function() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 10);
    };
    
    // Delete workout
    window.deleteWorkout = async function(workoutId) {
        if (!confirm('Are you sure you want to delete this workout?')) return;
        
        try {
            await api.delete(`/workouts/${workoutId}`);
            loadWorkouts();
            if (typeof today !== 'undefined') today.loadToday();
        } catch (error) {
            console.error('Error deleting workout:', error);
            alert('Failed to delete workout');
        }
    };
    
    // Show history detail view
    window.showHistoryDetail = async function(workoutId) {
        try {
            const workout = await api.get(`/workouts/${workoutId}`);
            
            // Create panel container
            const panel = document.createElement('div');
            panel.className = 'history-detail-panel';
            
            // Build workout name
            const workoutName = (workout.name && workout.name.trim() !== '') 
                ? workout.name 
                : `Workout #${workout.id}`;
            
            const date = new Date(workout.started_at);
            const totalWeight = calculateTotalWeight(workout);
            
            // Build set rows for detail view
            let exercisesHtml = '';
            if (workout.exercises && workout.exercises.length > 0) {
                exercisesHtml = workout.exercises.map(ex => {
                    const setRows = (ex.sets || []).map((set, idx) => {
                        const hasHold = set.hold_seconds !== null && set.hold_seconds !== undefined && set.hold_seconds !== '';
                        
                        // For failure sets, show "F" instead of number
                        let setNumDisplay;
                        if (set.to_failure) {
                            setNumDisplay = '<span class="history-detail-set-num-fail">F</span>';
                        } else {
                            setNumDisplay = `<span class="history-detail-set-num">Set ${idx + 1}</span>`;
                        }
                        
                        // Format the set stats
                        let statsHtml = '';
                        if (hasHold) {
                            statsHtml = `${set.weight_kg} kg × ${set.hold_seconds}s hold`;
                        } else {
                            const repsDisplay = set.reps !== null ? `${set.reps} reps` : '';
                            statsHtml = set.weight_kg !== null 
                                ? `${set.weight_kg} kg × ${repsDisplay}`.trim() 
                                : (repsDisplay ? repsDisplay : '');
                        }
                        
                        return `
                            <div class="history-detail-set">
                                <div class="history-detail-set-info">
                                    ${setNumDisplay}
                                    <span class="history-detail-set-stats">${statsHtml}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                    
                    return `
                        <div class="history-detail-exercise">
                            <div class="history-detail-exercise-name">${ex.name}</div>
                            ${setRows}
                        </div>
                    `;
                }).join('');
            } else {
                exercisesHtml = '<p style="color: #999;">No exercises recorded in this workout.</p>';
            }
            
            // Duration display
            const durationDisplay = formatDuration(workout.duration_seconds);
            
            panel.innerHTML = `
                <div class="history-detail-header">
                    <button class="history-detail-close" onclick="this.closest('.history-detail-panel').remove()">×</button>
                    <div class="history-detail-title">${workoutName}</div>
                    <div class="history-detail-actions">
                        <button onclick="openHistoryWorkoutEdit(${workoutId}); this.closest('.history-detail-panel').remove()" class="history-detail-edit-btn">Edit</button>
                    </div>
                </div>
                
                <div class="history-detail-content">
                    <div class="history-detail-date">${formatDate(date)} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    
                    <div class="history-detail-stats">
                        <div class="history-detail-stat" title="Duration">
                            <span class="history-detail-stat-icon">⏱️</span>
                            ${durationDisplay}
                        </div>
                        <div class="history-detail-stat" title="Total weight lifted">
                            <span class="history-detail-stat-icon">🏋️</span>
                            ${totalWeight > 0 ? `${totalWeight} kg` : '—'}
                        </div>
                    </div>
                    
                    ${exercisesHtml}
                </div>
            `;
            
            document.body.appendChild(panel);
        } catch (error) {
            console.error('Error loading workout detail:', error);
            alert('Failed to load workout details');
        }
    };
});

// ========== Food Photo Analysis Functionality ==========
const foodPhoto = {
    /**
     * Initialize food photo capture functionality. Capture opens the native
     * camera via a plain file input (same pattern as "Add a new product"'s
     * label photo) - no custom camera/canvas overlay, since that path had a
     * bug (canvas sized before the video stream loaded) that produced
     * invalid 0x0 images and an unwanted mirror effect on the back camera.
     */
    init() {
        const captureBtn = document.getElementById('capture-photo-btn');
        const photoInput = document.getElementById('photo-input');

        if (captureBtn && photoInput) {
            captureBtn.addEventListener('click', () => photoInput.click());
        }

        if (photoInput) {
            photoInput.addEventListener('change', async (e) => await this.handleFileSelect(e));
        }
    },

    /**
     * Handle selected/captured file
     */
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file || !file.type.startsWith('image/')) {
            return;
        }

        await this.handlePhotoFile(file);

        // Reset the file input so selecting the same file again still fires 'change'
        event.target.value = '';
    },

    /**
     * Analyze the photo, then hand identified items off to the shared meal
     * builder (same one "Add Meal" uses) so the user can review, adjust
     * portions, and save exactly like a manually-searched meal.
     */
    async handlePhotoFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            return;
        }

        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) loadingIndicator.style.display = 'block';

        try {
            const result = await this.analyzePhoto(file);

            if (result && result.items && result.items.length > 0) {
                await this.addIdentifiedItemsToMeal(result.items);
            } else {
                alert('No food items were identified in the photo. Please try again with a clearer image.');
            }
        } catch (error) {
            console.error('Error analyzing photo:', error);
            alert('Failed to analyze photo. Make sure LM Studio is running on http://localhost:3142');
        } finally {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    },

    /**
     * Analyze photo using backend API
     */
    async analyzePhoto(file) {
        // iOS Safari bug workaround: a freshly-captured camera photo's File
        // object can serialize as an empty (Content-Length: 0) upload body
        // when handed straight to FormData/fetch, even though file.size
        // looks correct. Reading it into memory first forces the data to
        // fully materialize before the request is built.
        const arrayBuffer = await file.arrayBuffer();
        const photoBlob = new Blob([arrayBuffer], { type: file.type || 'image/jpeg' });

        const formData = new FormData();
        formData.append('photo', photoBlob, file.name || 'photo.jpg');

        try {
            // Build URL using window.location.origin (backend API)
            const response = await fetch(`${window.location.origin}/meals/photo`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Photo analysis error:', error);

            // Check if it's a network error (LM Studio not available)
            if (!navigator.onLine) {
                throw new Error('No internet connection. LM Studio may not be accessible.');
            }

            // Try to get error details from response
            try {
                const errorData = await response.json();
                throw new Error(errorData.detail || errorData.message || 'Failed to analyze photo');
            } catch (e) {
                // If response is not JSON, use the original error
                throw error;
            }
        }
    },

    /**
     * Match each identified item (name + estimated_portion_g) against the
     * local food database via the same /foods/search used by manual entry,
     * and load matches into a fresh meal in foodSearch's builder - the
     * vision model only identifies food and estimates portion size (per
     * SPEC); actual macros always come from the local database, never the
     * model. The user reviews/adjusts everything (including swapping a
     * wrong match) before saving.
     */
    async addIdentifiedItemsToMeal(items) {
        foodSearch.openMealBuilder();

        const unmatched = [];
        for (const item of items) {
            try {
                const results = await api.get(`/foods/search?q=${encodeURIComponent(item.name)}`);
                if (results && results.length > 0) {
                    const food = results[0];
                    foodSearch.items.push({
                        fdc_id: food.id,
                        name: food.description,
                        grams: item.estimated_portion_g,
                        per100: {
                            calories: food.calories_kcal,
                            protein_g: food.protein_g,
                            carbs_g: food.carbs_g,
                            fat_g: food.fat_g,
                        },
                    });
                } else {
                    unmatched.push(item.name);
                }
            } catch (error) {
                console.error('Error matching identified food to the local database:', item.name, error);
                unmatched.push(item.name);
            }
        }

        foodSearch.renderMeal();

        const section = document.getElementById('search-meal-section');
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });

        if (unmatched.length > 0) {
            const matchedCount = items.length - unmatched.length;
            alert(
                `Added ${matchedCount} of ${items.length} identified item(s) to your meal.\n\n` +
                `Couldn't find nutrition data for: ${unmatched.join(', ')}. ` +
                `Add ${unmatched.length === 1 ? 'it' : 'them'} manually via "Add Food" if needed.`
            );
        }
    }
};

// ========== Manual Food Search Functionality ==========
const foodSearch = {
    /** Items added to the meal currently being built (in memory, not yet saved).
     *  Each item keeps its per-100g macros so grams can be edited live. */
    items: [],

    /** Debounce timer for the search input */
    searchDebounce: null,

    /** Cached list of saved meal templates, from the last loadMealTemplates() call */
    templates: [],

    /** {id, name} while editing an existing template's items in the builder, else null */
    activeTemplateEdit: null,

    /**
     * Wire up the "Add meal" entry point, the food search button, and the
     * meal-in-progress save/cancel buttons. Also loads the saved meals list.
     */
    init() {
        const addMealBtn = document.getElementById('add-meal-btn');
        if (addMealBtn) {
            addMealBtn.addEventListener('click', () => this.openMealBuilder());
        }

        const addFromTemplateBtn = document.getElementById('add-from-template-btn');
        if (addFromTemplateBtn) {
            addFromTemplateBtn.addEventListener('click', () => this.showTemplatePickerModal());
        }

        const addFoodBtn = document.getElementById('add-food-btn');
        if (addFoodBtn) {
            addFoodBtn.addEventListener('click', () => this.openSearchModal());
        }

        const saveBtn = document.getElementById('save-search-meal-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveMeal());
        }

        const clearBtn = document.getElementById('clear-search-meal-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.closeMealBuilder());
        }

        const saveTemplateBtn = document.getElementById('save-as-template-btn');
        if (saveTemplateBtn) {
            saveTemplateBtn.addEventListener('click', () => this.saveAsTemplate());
        }

        // Quick-pick buttons fill the name field but leave it editable,
        // so "Lunch" can still be typed further into "Lunch - Salad Bar (work)"
        document.querySelectorAll('.meal-quick-name-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const nameInput = document.getElementById('meal-name-input');
                if (nameInput) nameInput.value = btn.dataset.name;
            });
        });

        loadNutritionDiary();
        this.loadMealTemplates();
    },

    /**
     * Toggle the builder between logging a dated meal ('meal') and editing a
     * template's items directly ('template-edit', no date, single save action).
     */
    setBuilderMode(mode) {
        const dateRow = document.getElementById('meal-date-row');
        const saveBtn = document.getElementById('save-search-meal-btn');
        const saveTemplateBtn = document.getElementById('save-as-template-btn');

        if (mode === 'template-edit') {
            if (dateRow) dateRow.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'none';
            if (saveTemplateBtn) saveTemplateBtn.textContent = '💾 Update Template';
        } else {
            if (dateRow) dateRow.style.display = '';
            if (saveBtn) saveBtn.style.display = 'block';
            if (saveTemplateBtn) saveTemplateBtn.textContent = '💾 Save as Template';
        }
    },

    /**
     * Open the meal builder for a brand new meal: show the meal type/date
     * fields and the (empty) item list, and hide the "Add Meal" entry point.
     */
    openMealBuilder() {
        activeMeal = null;
        this.activeTemplateEdit = null;
        this.items = [];

        const addMealCard = document.getElementById('add-meal-card');
        if (addMealCard) addMealCard.style.display = 'none';

        const section = document.getElementById('search-meal-section');
        if (section) section.style.display = 'block';

        const titleEl = document.getElementById('meal-builder-title');
        if (titleEl) titleEl.textContent = 'New Meal';

        const saveBtn = document.getElementById('save-search-meal-btn');
        if (saveBtn) saveBtn.textContent = 'Save Meal';

        const dateInput = document.getElementById('meal-date-input');
        if (dateInput) {
            const today = new Date();
            const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
            dateInput.value = localDate.toISOString().slice(0, 10);
        }

        const nameInput = document.getElementById('meal-name-input');
        if (nameInput) nameInput.value = '';

        this.setBuilderMode('meal');
        this.renderMeal();
    },

    /**
     * Close the meal builder without saving, discarding any added/edited items.
     */
    closeMealBuilder() {
        activeMeal = null;
        this.activeTemplateEdit = null;
        this.items = [];

        const section = document.getElementById('search-meal-section');
        if (section) section.style.display = 'none';

        const addMealCard = document.getElementById('add-meal-card');
        if (addMealCard) addMealCard.style.display = 'block';
    },

    /**
     * Open the food search modal: a search box with live results
     */
    openSearchModal() {
        const existing = document.getElementById('food-search-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'food-search-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            border-radius: 12px;
            width: 90%;
            max-width: 400px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'padding: 1rem; border-bottom: 1px solid #eee;';

        const title = document.createElement('h3');
        title.textContent = 'Search Foods';
        title.style.marginBottom = '0.5rem';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'e.g. chicken breast';
        searchInput.style.cssText = `
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 1rem;
        `;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(this.searchDebounce);
            const term = e.target.value;
            this.searchDebounce = setTimeout(() => this.runSearch(term), 250);
        });

        header.appendChild(title);
        header.appendChild(searchInput);

        // Search results view (default)
        const searchView = document.createElement('div');
        searchView.id = 'food-search-view';
        searchView.style.cssText = 'display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;';

        const list = document.createElement('div');
        list.id = 'food-search-results';
        list.style.cssText = 'padding: 0.5rem; overflow-y: auto; flex: 1; min-height: 0;';
        list.innerHTML = '<p style="color: #888; text-align: center; padding: 1rem;">Start typing to search</p>';

        const addProductBtn = document.createElement('button');
        addProductBtn.textContent = "+ Add a new product";
        addProductBtn.className = 'btn btn-secondary';
        addProductBtn.style.cssText = 'margin: 0.5rem; width: calc(100% - 1rem);';
        addProductBtn.addEventListener('click', () => this.showAddProductView());

        searchView.appendChild(list);
        searchView.appendChild(addProductBtn);

        // Add-a-new-product view (hidden until "+ Add a new product" is clicked)
        const addView = document.createElement('div');
        addView.id = 'food-add-product-view';
        addView.style.cssText = 'display: none; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; padding: 1rem;';

        // Amount view (hidden until a search result is tapped): choose grams
        // or a defined serving, and optionally define a new serving here
        const amountView = document.createElement('div');
        amountView.id = 'food-amount-view';
        amountView.style.cssText = 'display: none; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; padding: 1rem;';

        const footer = document.createElement('div');
        footer.style.cssText = 'padding: 1rem; border-top: 1px solid #eee;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.className = 'btn btn-secondary';
        closeBtn.addEventListener('click', () => modal.remove());
        footer.appendChild(closeBtn);

        content.appendChild(header);
        content.appendChild(searchView);
        content.appendChild(addView);
        content.appendChild(amountView);
        content.appendChild(footer);
        modal.appendChild(content);
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        searchInput.focus();
    },

    /**
     * Query GET /foods/search and render results into the open modal
     */
    async runSearch(term) {
        const list = document.getElementById('food-search-results');
        if (!list) return;

        const query = term.trim();
        if (!query) {
            list.innerHTML = '<p style="color: #888; text-align: center; padding: 1rem;">Start typing to search</p>';
            return;
        }

        try {
            const results = await api.get(`/foods/search?q=${encodeURIComponent(query)}`);
            this.renderSearchResults(results);
        } catch (error) {
            console.error('Food search error:', error);
            list.innerHTML = '<p style="color: #888; text-align: center; padding: 1rem;">Search failed</p>';
        }
    },

    /**
     * Render the live search results list inside the modal
     */
    renderSearchResults(results) {
        const list = document.getElementById('food-search-results');
        if (!list) return;

        if (results.length === 0) {
            list.innerHTML = '<p style="color: #888; text-align: center; padding: 1rem;">No matches</p>';
            return;
        }

        list.innerHTML = results.map((food, index) => `
            <div class="food-search-result" data-index="${index}" style="padding: 0.75rem; border-bottom: 1px solid #f0f0f0; cursor: pointer;">
                <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem;">
                    <div style="font-weight: bold; color: #1a1a2e;">${this.escapeHtml(food.description)}</div>
                    <div style="flex-shrink: 0; display: flex; align-items: center; gap: 0.4rem;">
                        <span style="font-size: 0.65rem; padding: 0.15rem 0.4rem; border-radius: 4px; color: white; white-space: nowrap; background: ${food.source === 'custom' ? '#e94560' : '#1a1a2e'};">${food.source === 'custom' ? 'YOURS' : 'USDA'}</span>
                        <button type="button" class="edit-custom-food-btn" data-index="${index}" title="Edit this food" style="background: none; border: none; color: #666; cursor: pointer; font-size: 0.9rem; padding: 0;">✎</button>
                    </div>
                </div>
                <div style="font-size: 0.8rem; color: #666; margin-top: 0.25rem;">
                    ${Math.round(food.calories_kcal)} kcal · ${food.protein_g.toFixed(1)}g P · ${food.carbs_g.toFixed(1)}g C · ${food.fat_g.toFixed(1)}g F
                    <span style="color: #999;">(per 100g)</span>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('.food-search-result').forEach((el) => {
            el.addEventListener('click', () => {
                const food = results[parseInt(el.dataset.index, 10)];
                this.selectFood(food);
            });
        });

        list.querySelectorAll('.edit-custom-food-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const food = results[parseInt(btn.dataset.index, 10)];
                this.showEditProductView(food);
            });
        });
    },

    /**
     * Handle picking a food from search results: open the amount view so the
     * user can choose grams or a defined serving (e.g. "3 rice cakes")
     * before it's added to the meal being built.
     */
    selectFood(food) {
        this.showAmountView(food);
    },

    /**
     * Show the amount-entry view for a food: grams by default, or any
     * defined serving as a selectable "unit", plus a way to define a new
     * serving right here. food.servings is mutated in place as servings are
     * added/removed so the chip list stays in sync without re-searching.
     */
    showAmountView(food) {
        this.amountFood = food;
        this.amountUnit = 'grams';

        const searchView = document.getElementById('food-search-view');
        const addView = document.getElementById('food-add-product-view');
        const amountView = document.getElementById('food-amount-view');
        if (searchView) searchView.style.display = 'none';
        if (addView) addView.style.display = 'none';
        if (!amountView) return;
        amountView.style.display = 'flex';

        amountView.innerHTML = `
            <button id="back-to-search-from-amount-btn" style="align-self: flex-start; background: none; border: none; color: #666; cursor: pointer; font-size: 0.9rem; margin-bottom: 0.75rem; padding: 0;">← Back to search</button>

            <div style="font-weight: bold; font-size: 1.05rem; color: #1a1a2e; margin-bottom: 0.25rem;">${this.escapeHtml(food.description)}</div>
            <div style="font-size: 0.8rem; color: #999; margin-bottom: 1rem;">
                ${Math.round(food.calories_kcal)} kcal · ${food.protein_g.toFixed(1)}g P · ${food.carbs_g.toFixed(1)}g C · ${food.fat_g.toFixed(1)}g F
                <span style="color: #999;">(per 100g)</span>
            </div>

            <label style="font-size: 0.85rem; color: #666;">Amount</label>
            <div id="unit-chips" style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.4rem 0 0.75rem;"></div>

            <input type="number" step="any" min="0" id="amount-value-input" value="100" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.95rem; margin-bottom: 0.5rem;">

            <div id="amount-preview" style="font-size: 0.85rem; color: #666; margin-bottom: 1rem;"></div>

            <button id="toggle-new-serving-btn" style="background: none; border: none; color: #e94560; cursor: pointer; font-size: 0.85rem; padding: 0; margin-bottom: 0.75rem; text-align: left;">+ Define a new serving</button>

            <div id="new-serving-form" style="display: none; margin-bottom: 0.75rem;">
                <input type="text" id="new-serving-label-input" placeholder="Label (e.g. rice cake)" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.95rem; margin-bottom: 0.5rem;">
                <input type="number" step="any" min="0" id="new-serving-grams-input" placeholder="Grams per unit (e.g. 9)" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.95rem; margin-bottom: 0.5rem;">
                <button id="save-new-serving-btn" class="btn btn-secondary">Save Serving</button>
            </div>

            <button id="confirm-amount-btn" class="btn" style="margin-top: 0.5rem;">Add to Meal</button>
        `;

        document.getElementById('back-to-search-from-amount-btn').addEventListener('click', () => this.showSearchView());
        document.getElementById('amount-value-input').addEventListener('input', () => this.updateAmountPreview());
        document.getElementById('toggle-new-serving-btn').addEventListener('click', () => this.toggleNewServingForm());
        document.getElementById('save-new-serving-btn').addEventListener('click', () => this.saveNewServing());
        document.getElementById('confirm-amount-btn').addEventListener('click', () => this.confirmAmount());

        this.renderUnitChips();
        this.updateAmountPreview();
    },

    /**
     * Render the "Grams" + one chip per defined serving. Tapping a serving
     * chip switches the active unit; tapping its × deletes the serving.
     */
    renderUnitChips() {
        const container = document.getElementById('unit-chips');
        if (!container || !this.amountFood) return;

        const chipStyle = (active) => `
            display: inline-flex; align-items: center; gap: 0.35rem;
            padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid ${active ? '#e94560' : '#ddd'};
            background: ${active ? '#e94560' : 'white'}; color: ${active ? 'white' : '#333'};
            font-size: 0.85rem; cursor: pointer;
        `;

        const units = [{ unit: 'grams', label: 'Grams' }].concat(
            (this.amountFood.servings || []).map((s) => ({ unit: `serving-${s.id}`, label: s.label, servingId: s.id }))
        );

        container.innerHTML = units.map((u) => `
            <button type="button" class="unit-chip" data-unit="${u.unit}" style="${chipStyle(u.unit === this.amountUnit)}">
                ${this.escapeHtml(u.label)}
                ${u.servingId ? `<span class="delete-serving-chip" data-serving-id="${u.servingId}" style="color: ${u.unit === this.amountUnit ? 'white' : '#dc3545'}; font-weight: bold;">×</span>` : ''}
            </button>
        `).join('');

        container.querySelectorAll('.unit-chip').forEach((chip) => {
            chip.addEventListener('click', (e) => {
                // Ignore clicks on the × (handled separately below)
                if (e.target.classList.contains('delete-serving-chip')) return;
                this.amountUnit = chip.dataset.unit;
                const valueInput = document.getElementById('amount-value-input');
                if (valueInput) valueInput.value = this.amountUnit === 'grams' ? '100' : '1';
                this.renderUnitChips();
                this.updateAmountPreview();
            });
        });

        container.querySelectorAll('.delete-serving-chip').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteServing(parseInt(btn.dataset.servingId, 10));
            });
        });
    },

    /**
     * Compute grams for the current unit + amount value: the raw number for
     * "Grams", or count × grams_per_unit for a selected serving.
     */
    computeAmountGrams() {
        const valueInput = document.getElementById('amount-value-input');
        const value = valueInput ? parseFloat(valueInput.value) : NaN;
        if (isNaN(value) || value <= 0) return null;

        if (this.amountUnit === 'grams') return { grams: value, servingLabel: null, servingCount: null };

        const servingId = parseInt(this.amountUnit.replace('serving-', ''), 10);
        const serving = (this.amountFood.servings || []).find((s) => s.id === servingId);
        if (!serving) return null;

        return { grams: value * serving.grams_per_unit, servingLabel: serving.label, servingCount: value };
    },

    /**
     * Live preview: "= 27g · 100 kcal · ..." as the amount/unit changes
     */
    updateAmountPreview() {
        const previewEl = document.getElementById('amount-preview');
        if (!previewEl || !this.amountFood) return;

        const result = this.computeAmountGrams();
        if (!result) {
            previewEl.textContent = 'Enter a valid amount.';
            return;
        }

        const scale = result.grams / 100;
        const cal = this.amountFood.calories_kcal * scale;
        const pro = this.amountFood.protein_g * scale;
        const carb = this.amountFood.carbs_g * scale;
        const fat = this.amountFood.fat_g * scale;

        previewEl.textContent = `= ${Math.round(result.grams * 10) / 10}g · ${Math.round(cal)} kcal · ${pro.toFixed(1)}g P · ${carb.toFixed(1)}g C · ${fat.toFixed(1)}g F`;
    },

    toggleNewServingForm() {
        const form = document.getElementById('new-serving-form');
        if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    },

    /**
     * Save a new serving for the food currently being amounted, via
     * POST /foods/servings, then add it to the chip list immediately.
     */
    async saveNewServing() {
        const labelInput = document.getElementById('new-serving-label-input');
        const gramsInput = document.getElementById('new-serving-grams-input');
        const label = labelInput ? labelInput.value.trim() : '';
        const gramsPerUnit = gramsInput ? parseFloat(gramsInput.value) : NaN;

        if (!label) {
            alert('Please enter a label for the serving.');
            return;
        }
        if (isNaN(gramsPerUnit) || gramsPerUnit <= 0) {
            alert('Please enter how many grams one unit weighs.');
            return;
        }

        try {
            const serving = await api.post('/foods/servings', {
                food_id: this.amountFood.id,
                food_source: this.amountFood.source,
                label,
                grams_per_unit: gramsPerUnit,
            });

            if (!this.amountFood.servings) this.amountFood.servings = [];
            this.amountFood.servings.push(serving);

            labelInput.value = '';
            gramsInput.value = '';
            this.toggleNewServingForm();

            // Switch straight to the newly-defined serving
            this.amountUnit = `serving-${serving.id}`;
            const valueInput = document.getElementById('amount-value-input');
            if (valueInput) valueInput.value = '1';

            this.renderUnitChips();
            this.updateAmountPreview();
        } catch (error) {
            console.error('Error saving serving:', error);
            alert('Failed to save serving');
        }
    },

    /**
     * Delete a serving via DELETE /foods/servings/{id}
     */
    async deleteServing(servingId) {
        if (!confirm('Delete this serving?')) return;

        try {
            await api.delete(`/foods/servings/${servingId}`);
            this.amountFood.servings = (this.amountFood.servings || []).filter((s) => s.id !== servingId);
            if (this.amountUnit === `serving-${servingId}`) {
                this.amountUnit = 'grams';
                const valueInput = document.getElementById('amount-value-input');
                if (valueInput) valueInput.value = '100';
            }
            this.renderUnitChips();
            this.updateAmountPreview();
        } catch (error) {
            console.error('Error deleting serving:', error);
            alert('Failed to delete serving');
        }
    },

    /**
     * Add the food to the meal being built at the chosen amount, then close
     * the search modal (mirrors the old selectFood's end-of-flow behavior)
     */
    confirmAmount() {
        const result = this.computeAmountGrams();
        if (!result) {
            alert('Please enter a valid amount.');
            return;
        }

        this.items.push({
            fdc_id: this.amountFood.id,
            name: this.amountFood.description,
            grams: result.grams,
            per100: {
                calories: this.amountFood.calories_kcal,
                protein_g: this.amountFood.protein_g,
                carbs_g: this.amountFood.carbs_g,
                fat_g: this.amountFood.fat_g,
            },
            servingLabel: result.servingLabel,
            servingCount: result.servingCount,
        });

        const modal = document.getElementById('food-search-modal');
        if (modal) modal.remove();

        this.renderMeal();
    },

    /**
     * Switch the search modal to the "add a new product" view: a photo
     * capture input plus a review form, for when a search doesn't find
     * the product the user wants.
     */
    showAddProductView() {
        this.editingFoodId = null;
        this.editingFoodSource = null;
        this.editingFood = null;
        this.editingServingId = null;

        const searchView = document.getElementById('food-search-view');
        const addView = document.getElementById('food-add-product-view');
        if (searchView) searchView.style.display = 'none';
        if (addView) addView.style.display = 'flex';
        if (!addView) return;

        addView.innerHTML = `
            <button id="back-to-search-btn" style="align-self: flex-start; background: none; border: none; color: #666; cursor: pointer; font-size: 0.9rem; margin-bottom: 0.75rem; padding: 0;">← Back to search</button>
            <p style="font-size: 0.9rem; color: #666; margin-bottom: 0.75rem;">Take a photo of the product's nutrition label to fill in the details, or enter them manually below.</p>
            <input type="file" id="label-photo-input" accept="image/*" capture="environment" style="margin-bottom: 0.5rem;">
            <div id="label-scan-status" style="font-size: 0.85rem; color: #666; margin-bottom: 0.75rem;"></div>
            <div id="add-product-form"></div>
        `;

        document.getElementById('back-to-search-btn').addEventListener('click', () => this.showSearchView());
        document.getElementById('label-photo-input').addEventListener('change', (e) => this.handleLabelPhoto(e));

        // Blank form is ready immediately, so manual entry works with no photo at all
        this.renderAddProductForm({});
    },

    /**
     * Return to the search results view from the add-product or amount view
     */
    showSearchView() {
        const searchView = document.getElementById('food-search-view');
        const addView = document.getElementById('food-add-product-view');
        const amountView = document.getElementById('food-amount-view');
        if (addView) addView.style.display = 'none';
        if (amountView) amountView.style.display = 'none';
        if (searchView) searchView.style.display = 'flex';
    },

    /**
     * Switch the search modal to "edit this food" - works for both your own
     * custom products (source="custom") and USDA foods (source="usda").
     * Reuses the same review form as adding a product, pre-filled with the
     * food's current values.
     */
    showEditProductView(food) {
        this.editingFoodId = food.id;
        this.editingFoodSource = food.source;
        this.editingFood = food; // kept around so serving add/edit/delete can mutate food.servings in place
        this.editingServingId = null;

        const searchView = document.getElementById('food-search-view');
        const addView = document.getElementById('food-add-product-view');
        if (searchView) searchView.style.display = 'none';
        if (!addView) return;
        addView.style.display = 'flex';

        const usdaNote = food.source === 'usda'
            ? `<p style="font-size: 0.8rem; color: #999; margin-bottom: 0.75rem;">This is USDA reference data. Your edit is saved as a personal correction and won't be lost if the USDA dataset is ever refreshed.</p>`
            : '';

        addView.innerHTML = `
            <button id="back-to-search-btn" style="align-self: flex-start; background: none; border: none; color: #666; cursor: pointer; font-size: 0.9rem; margin-bottom: 0.75rem; padding: 0;">← Back to search</button>
            <p style="font-size: 0.9rem; color: #666; margin-bottom: 0.75rem;">Edit this food's details.</p>
            ${usdaNote}
            <div id="add-product-form"></div>
        `;

        document.getElementById('back-to-search-btn').addEventListener('click', () => this.showSearchView());

        this.renderEditProductForm(food);
    },

    /**
     * Render the review form pre-filled with a food's current values (as
     * opposed to renderAddProductForm, which pre-fills from a freshly-
     * scanned label). Custom products get a Delete option; USDA foods get a
     * Revert option instead (deleting official reference data doesn't make
     * sense - reverting the correction does).
     */
    renderEditProductForm(food) {
        const formEl = document.getElementById('add-product-form');
        if (!formEl) return;

        const fieldStyle = 'width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.95rem; margin-bottom: 0.5rem;';
        const labelStyle = 'font-size: 0.85rem; color: #666;';
        const isUsda = food.source === 'usda';

        formEl.innerHTML = `
            <label style="${labelStyle}">${isUsda ? 'Food name' : 'Product name'}</label>
            <input type="text" id="product-name-input" value="${this.escapeHtml(food.description)}" style="${fieldStyle}">

            <p style="font-size: 0.8rem; color: #999; margin-bottom: 0.5rem;">Per 100g:</p>

            <label style="${labelStyle}">Calories (kcal)</label>
            <input type="number" step="any" id="product-calories-input" value="${food.calories_kcal}" style="${fieldStyle}">

            <label style="${labelStyle}">Protein (g)</label>
            <input type="number" step="any" id="product-protein-input" value="${food.protein_g}" style="${fieldStyle}">

            <label style="${labelStyle}">Carbs (g)</label>
            <input type="number" step="any" id="product-carbs-input" value="${food.carbs_g}" style="${fieldStyle}">

            <label style="${labelStyle}">Fat (g)</label>
            <input type="number" step="any" id="product-fat-input" value="${food.fat_g}" style="${fieldStyle}">

            <div style="margin: 0.75rem 0 1rem; padding-top: 0.75rem; border-top: 1px solid #eee;">
                <label style="${labelStyle}">Servings</label>
                <div id="edit-servings-list" style="margin: 0.5rem 0;"></div>
                <button type="button" id="toggle-new-serving-in-edit-btn" style="background: none; border: none; color: #e94560; cursor: pointer; font-size: 0.85rem; padding: 0; text-align: left;">+ Add a serving</button>
                <div id="new-serving-in-edit-form" style="display: none; margin-top: 0.5rem;">
                    <input type="text" id="edit-new-serving-label-input" placeholder="Label (e.g. rice cake)" style="${fieldStyle}">
                    <input type="number" step="any" min="0" id="edit-new-serving-grams-input" placeholder="Grams per unit (e.g. 9)" style="${fieldStyle}">
                    <button type="button" id="save-new-serving-in-edit-btn" class="btn btn-secondary">Save Serving</button>
                </div>
            </div>

            <button id="save-product-btn" class="btn" style="margin-top: 0.5rem;">Save Changes</button>
            ${isUsda
                ? `<button id="revert-product-btn" class="btn btn-secondary" style="margin-top: 0.5rem;">Revert to Original USDA Values</button>`
                : `<button id="delete-product-btn" class="btn btn-danger" style="margin-top: 0.5rem;">Delete Product</button>`}
        `;

        document.getElementById('save-product-btn').addEventListener('click', () => this.saveCustomProduct());
        if (isUsda) {
            document.getElementById('revert-product-btn').addEventListener('click', () => this.revertUsdaFood());
        } else {
            document.getElementById('delete-product-btn').addEventListener('click', () => this.deleteCustomProduct());
        }

        document.getElementById('toggle-new-serving-in-edit-btn').addEventListener('click', () => {
            const form = document.getElementById('new-serving-in-edit-form');
            if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
        });
        document.getElementById('save-new-serving-in-edit-btn').addEventListener('click', () => this.addServingInEdit());

        this.renderEditServingsList();
    },

    /**
     * Render the servings list within the edit-food form: each serving shows
     * as "label = Ng" with ✎/× actions, or as an inline label+grams editor
     * when it's the one currently being edited (editingServingId)
     */
    renderEditServingsList() {
        const listEl = document.getElementById('edit-servings-list');
        if (!listEl || !this.editingFood) return;

        const servings = this.editingFood.servings || [];
        if (servings.length === 0) {
            listEl.innerHTML = '<p style="font-size: 0.85rem; color: #999;">No servings defined yet.</p>';
            return;
        }

        const fieldStyle = 'padding: 0.4rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.85rem;';

        listEl.innerHTML = servings.map((s) => {
            if (this.editingServingId === s.id) {
                return `
                    <div style="display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.4rem;">
                        <input type="text" id="inline-serving-label-input" value="${this.escapeHtml(s.label)}" style="${fieldStyle} flex: 1;">
                        <input type="number" step="any" min="0" id="inline-serving-grams-input" value="${s.grams_per_unit}" style="${fieldStyle} width: 64px;">
                        <span style="font-size: 0.8rem; color: #666;">g</span>
                        <button type="button" class="save-serving-inline-btn" data-serving-id="${s.id}" style="background: none; border: none; color: #2e7d32; cursor: pointer; font-size: 1rem; padding: 0 0.25rem;">✓</button>
                        <button type="button" class="cancel-serving-inline-btn" style="background: none; border: none; color: #666; cursor: pointer; font-size: 1rem; padding: 0 0.25rem;">×</button>
                    </div>
                `;
            }
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; font-size: 0.85rem;">
                    <span>${this.escapeHtml(s.label)} = ${s.grams_per_unit}g</span>
                    <span>
                        <button type="button" class="edit-serving-inline-btn" data-serving-id="${s.id}" style="background: none; border: none; color: #666; cursor: pointer; font-size: 0.85rem; padding: 0 0.35rem;">✎</button>
                        <button type="button" class="delete-serving-inline-btn" data-serving-id="${s.id}" style="background: none; border: none; color: #dc3545; cursor: pointer; font-size: 0.95rem; padding: 0 0.35rem;">×</button>
                    </span>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.edit-serving-inline-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.editingServingId = parseInt(btn.dataset.servingId, 10);
                this.renderEditServingsList();
            });
        });
        listEl.querySelectorAll('.cancel-serving-inline-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.editingServingId = null;
                this.renderEditServingsList();
            });
        });
        listEl.querySelectorAll('.save-serving-inline-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.saveServingInline(parseInt(btn.dataset.servingId, 10)));
        });
        listEl.querySelectorAll('.delete-serving-inline-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.deleteServingInEdit(parseInt(btn.dataset.servingId, 10)));
        });
    },

    /**
     * Save an inline serving edit via PATCH /foods/servings/{id}
     */
    async saveServingInline(servingId) {
        const labelInput = document.getElementById('inline-serving-label-input');
        const gramsInput = document.getElementById('inline-serving-grams-input');
        const label = labelInput ? labelInput.value.trim() : '';
        const gramsPerUnit = gramsInput ? parseFloat(gramsInput.value) : NaN;

        if (!label) {
            alert('Please enter a label for the serving.');
            return;
        }
        if (isNaN(gramsPerUnit) || gramsPerUnit <= 0) {
            alert('Please enter how many grams one unit weighs.');
            return;
        }

        try {
            const updated = await api.patch(`/foods/servings/${servingId}`, { label, grams_per_unit: gramsPerUnit });
            const serving = (this.editingFood.servings || []).find((s) => s.id === servingId);
            if (serving) {
                serving.label = updated.label;
                serving.grams_per_unit = updated.grams_per_unit;
            }
            this.editingServingId = null;
            this.renderEditServingsList();
        } catch (error) {
            console.error('Error updating serving:', error);
            alert('Failed to update serving');
        }
    },

    /**
     * Delete a serving from within the edit-food form
     */
    async deleteServingInEdit(servingId) {
        if (!confirm('Delete this serving?')) return;

        try {
            await api.delete(`/foods/servings/${servingId}`);
            this.editingFood.servings = (this.editingFood.servings || []).filter((s) => s.id !== servingId);
            if (this.editingServingId === servingId) this.editingServingId = null;
            this.renderEditServingsList();
        } catch (error) {
            console.error('Error deleting serving:', error);
            alert('Failed to delete serving');
        }
    },

    /**
     * Add a new serving from within the edit-food form
     */
    async addServingInEdit() {
        const labelInput = document.getElementById('edit-new-serving-label-input');
        const gramsInput = document.getElementById('edit-new-serving-grams-input');
        const label = labelInput ? labelInput.value.trim() : '';
        const gramsPerUnit = gramsInput ? parseFloat(gramsInput.value) : NaN;

        if (!label) {
            alert('Please enter a label for the serving.');
            return;
        }
        if (isNaN(gramsPerUnit) || gramsPerUnit <= 0) {
            alert('Please enter how many grams one unit weighs.');
            return;
        }

        try {
            const serving = await api.post('/foods/servings', {
                food_id: this.editingFoodId,
                food_source: this.editingFoodSource,
                label,
                grams_per_unit: gramsPerUnit,
            });

            if (!this.editingFood.servings) this.editingFood.servings = [];
            this.editingFood.servings.push(serving);

            labelInput.value = '';
            gramsInput.value = '';
            const form = document.getElementById('new-serving-in-edit-form');
            if (form) form.style.display = 'none';

            this.renderEditServingsList();
        } catch (error) {
            console.error('Error saving serving:', error);
            alert('Failed to save serving');
        }
    },

    /**
     * Upload the captured label photo to POST /foods/label-scan and
     * pre-fill the review form with whatever was extracted. Never treats a
     * failed/empty scan as an error - falls back to a blank form either way.
     */
    async handleLabelPhoto(event) {
        const file = event.target.files[0];
        if (!file) return;

        const statusEl = document.getElementById('label-scan-status');

        // Guard against a picked-but-empty file (e.g. the camera hand-off
        // getting interrupted) - uploading it would just come back empty,
        // so fail fast with a message that points at retaking the photo
        // rather than the more general "couldn't read it" wording.
        if (file.size === 0) {
            console.error('Label photo has 0 bytes - the file was not captured properly.');
            if (statusEl) statusEl.textContent = 'No photo was captured — please try again.';
            return;
        }

        if (statusEl) statusEl.textContent = 'Reading label…';

        try {
            // iOS Safari bug workaround: a freshly-captured camera photo's
            // File object can report a correct non-zero size yet still
            // serialize as an empty (Content-Length: 0) body when handed
            // straight to FormData/fetch - the underlying blob data isn't
            // always materialized yet right after capture. Explicitly
            // reading it into memory first and uploading that forces it to
            // fully load before the request is built.
            const arrayBuffer = await file.arrayBuffer();
            if (arrayBuffer.byteLength === 0) {
                console.error('Label photo read as 0 bytes even after arrayBuffer() - camera capture did not produce data.');
                if (statusEl) statusEl.textContent = 'No photo was captured — please try again.';
                return;
            }
            const photoBlob = new Blob([arrayBuffer], { type: file.type || 'image/jpeg' });

            const formData = new FormData();
            formData.append('photo', photoBlob, file.name || 'label.jpg');

            const response = await fetch(`${window.location.origin}/foods/label-scan`, {
                method: 'POST',
                body: formData,
                cache: 'no-store',
            });
            if (!response.ok) {
                const bodyText = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${bodyText}`);
            }
            const extracted = await response.json();

            const gotAnything = extracted.product_name || extracted.calories_kcal !== null;
            if (statusEl) {
                statusEl.textContent = gotAnything
                    ? 'Extracted from the label — review and correct before saving.'
                    : "Couldn't read anything on the label — enter the details manually.";
            }
            this.renderAddProductForm(extracted);
        } catch (error) {
            // A network/HTTP-level failure (e.g. the upload never reached the
            // server) is a different problem than the model finding nothing on
            // a legible photo - say so, since "couldn't read the label" reads
            // as a label-quality issue when it might really be a connection one.
            console.error('Label scan request failed:', error);
            if (statusEl) statusEl.textContent = "Upload failed — check your connection and try again, or enter the details manually.";
            this.renderAddProductForm({});
        }
    },

    /**
     * Render the editable product review form, pre-filled from a label scan
     * (if any). Macros are converted to per-100g using the extracted serving
     * size; every field stays editable so the user always reviews/corrects
     * before saving (mirrors the meal-photo pipeline's "always a draft" rule).
     */
    renderAddProductForm(extracted) {
        const formEl = document.getElementById('add-product-form');
        if (!formEl) return;

        const scale100 = (value) => {
            if (value === null || value === undefined) return '';
            if (!extracted.serving_size_g || extracted.serving_size_g <= 0) return value;
            return Math.round(value * (100 / extracted.serving_size_g) * 100) / 100;
        };

        const name = extracted.product_name || '';
        const calories = scale100(extracted.calories_kcal);
        const protein = scale100(extracted.protein_g);
        const carbs = scale100(extracted.carbs_g);
        const fat = scale100(extracted.fat_g);
        const fieldStyle = 'width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.95rem; margin-bottom: 0.5rem;';
        const labelStyle = 'font-size: 0.85rem; color: #666;';

        formEl.innerHTML = `
            <label style="${labelStyle}">Product name</label>
            <input type="text" id="product-name-input" value="${this.escapeHtml(String(name))}" style="${fieldStyle}">

            <p style="font-size: 0.8rem; color: #999; margin-bottom: 0.5rem;">
                Per 100g${extracted.serving_size_g ? ` (converted from a ${extracted.serving_size_g}g serving)` : ''}:
            </p>

            <label style="${labelStyle}">Calories (kcal)</label>
            <input type="number" step="any" id="product-calories-input" value="${calories}" style="${fieldStyle}">

            <label style="${labelStyle}">Protein (g)</label>
            <input type="number" step="any" id="product-protein-input" value="${protein}" style="${fieldStyle}">

            <label style="${labelStyle}">Carbs (g)</label>
            <input type="number" step="any" id="product-carbs-input" value="${carbs}" style="${fieldStyle}">

            <label style="${labelStyle}">Fat (g)</label>
            <input type="number" step="any" id="product-fat-input" value="${fat}" style="${fieldStyle}">

            <button id="save-product-btn" class="btn" style="margin-top: 0.5rem;">Save Product</button>
        `;

        document.getElementById('save-product-btn').addEventListener('click', () => this.saveCustomProduct());
    },

    /**
     * Save the reviewed food. When adding a brand new custom product
     * (editingFoodId is null), POSTs and treats it like picking a normal
     * search result - prompts for a portion and adds it to the meal being
     * built. When editing an existing food (custom or USDA), saves in place
     * and returns to a refreshed search instead (adjusting isn't "log it now").
     */
    async saveCustomProduct() {
        const nameInput = document.getElementById('product-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            alert('Please enter a name.');
            return;
        }

        const toNum = (id) => {
            const el = document.getElementById(id);
            const value = el ? parseFloat(el.value) : NaN;
            return isNaN(value) ? 0 : value;
        };

        const payload = {
            description: name,
            calories_kcal: toNum('product-calories-input'),
            protein_g: toNum('product-protein-input'),
            carbs_g: toNum('product-carbs-input'),
            fat_g: toNum('product-fat-input'),
        };

        try {
            if (this.editingFoodId && this.editingFoodSource === 'usda') {
                await api.patch(`/foods/usda/${this.editingFoodId}`, payload);
                this.editingFoodId = null;
                this.editingFoodSource = null;
                alert('Food updated!');
                this.returnToRefreshedSearch();
            } else if (this.editingFoodId) {
                await api.patch(`/foods/custom/${this.editingFoodId}`, payload);
                this.editingFoodId = null;
                this.editingFoodSource = null;
                alert('Product updated!');
                this.returnToRefreshedSearch();
            } else {
                const newFood = await api.post('/foods/custom', payload);
                const modal = document.getElementById('food-search-modal');
                if (modal) modal.remove();
                this.selectFood(newFood);
            }
        } catch (error) {
            console.error('Error saving food:', error);
            alert('Failed to save changes');
        }
    },

    /**
     * Delete the custom product currently being edited
     */
    async deleteCustomProduct() {
        if (!this.editingFoodId) return;
        if (!confirm('Delete this product? This cannot be undone.')) return;

        try {
            await api.delete(`/foods/custom/${this.editingFoodId}`);
            this.editingFoodId = null;
            this.editingFoodSource = null;
            alert('Product deleted.');
            this.returnToRefreshedSearch();
        } catch (error) {
            console.error('Error deleting product:', error);
            alert('Failed to delete product');
        }
    },

    /**
     * Discard a correction on the USDA food currently being edited, reverting
     * it back to the original imported name/macros
     */
    async revertUsdaFood() {
        if (!this.editingFoodId) return;
        if (!confirm('Revert to the original USDA values for this food?')) return;

        try {
            await api.delete(`/foods/usda/${this.editingFoodId}/override`);
            this.editingFoodId = null;
            this.editingFoodSource = null;
            alert('Reverted to the original USDA values.');
            this.returnToRefreshedSearch();
        } catch (error) {
            // A 404 just means there was no correction to revert (already original)
            console.error('Error reverting food:', error);
            this.editingFoodId = null;
            this.editingFoodSource = null;
            this.returnToRefreshedSearch();
        }
    },

    /**
     * After editing/deleting a product, go back to the search results view
     * and re-run the current query so the list reflects the change
     */
    returnToRefreshedSearch() {
        this.showSearchView();
        const searchInput = document.querySelector('#food-search-modal input[type="text"]');
        if (searchInput && searchInput.value.trim()) {
            this.runSearch(searchInput.value);
        } else {
            const list = document.getElementById('food-search-results');
            if (list) list.innerHTML = '<p style="color: #888; text-align: center; padding: 1rem;">Start typing to search</p>';
        }
    },

    /**
     * Compute an item's macros for its current grams from its per-100g values
     */
    computeMacros(item) {
        const scale = item.grams / 100;
        return {
            calories: item.per100.calories * scale,
            protein_g: item.per100.protein_g * scale,
            carbs_g: item.per100.carbs_g * scale,
            fat_g: item.per100.fat_g * scale,
        };
    },

    /**
     * Handle editing an item's grams: update the model and refresh just that
     * item's macro text plus the running total (not a full re-render, so the
     * grams input keeps focus while typing). Editing grams directly clears
     * any serving reference, since "3 rice cakes" would otherwise go stale
     * the moment the underlying grams no longer match count x grams_per_unit.
     */
    updateItemGrams(index, value) {
        const grams = parseFloat(value);
        if (isNaN(grams) || grams <= 0) return;

        this.items[index].grams = grams;
        this.items[index].servingLabel = null;
        this.items[index].servingCount = null;

        const macros = this.computeMacros(this.items[index]);
        const macrosEl = document.querySelector(`.item-macros[data-index="${index}"]`);
        if (macrosEl) {
            macrosEl.textContent = `${Math.round(macros.calories)} kcal · ${macros.protein_g.toFixed(1)}g P · ${macros.carbs_g.toFixed(1)}g C · ${macros.fat_g.toFixed(1)}g F`;
        }

        const servingEl = document.querySelector(`.item-serving[data-index="${index}"]`);
        if (servingEl) servingEl.textContent = '';

        this.updateTotal();
    },

    /**
     * Format a serving count for display: whole numbers with no decimal,
     * otherwise one decimal place
     */
    formatServingCount(count) {
        return Number.isInteger(count) ? String(count) : String(Math.round(count * 10) / 10);
    },

    /**
     * "3 rice cakes" for an item logged via a serving, or null if it was
     * logged (or has since been edited) in plain grams
     */
    formatServingText(item) {
        if (!item.servingLabel || item.servingCount == null) return null;
        const countText = this.formatServingCount(item.servingCount);
        const plural = item.servingCount === 1 ? '' : 's';
        return `${countText} ${item.servingLabel}${plural}`;
    },

    /**
     * Remove an item from the meal being built
     */
    removeItem(index) {
        this.items.splice(index, 1);
        this.renderMeal();
    },

    /**
     * Render the in-progress meal's item list (with editable grams inputs)
     */
    renderMeal() {
        const itemsEl = document.getElementById('search-meal-items');
        const emptyEl = document.getElementById('search-meal-empty');
        if (!itemsEl) return;

        if (this.items.length === 0) {
            itemsEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            this.updateTotal();
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';

        itemsEl.innerHTML = this.items.map((item, index) => {
            const macros = this.computeMacros(item);
            const servingText = this.formatServingText(item);
            return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0;">
                <div style="flex: 1;">
                    <div style="font-weight: bold;">${this.escapeHtml(item.name)}</div>
                    <div class="item-serving" data-index="${index}" style="font-size: 0.75rem; color: #e94560; margin-top: 0.1rem;">${servingText ? this.escapeHtml(servingText) : ''}</div>
                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-top: 0.25rem;">
                        <input type="number" min="1" step="1" value="${item.grams}" data-index="${index}" class="item-grams-input"
                            style="width: 64px; padding: 0.3rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.85rem;">
                        <span style="font-size: 0.8rem; color: #666;">g</span>
                        <span class="item-macros" data-index="${index}" style="font-size: 0.8rem; color: #666;">${Math.round(macros.calories)} kcal · ${macros.protein_g.toFixed(1)}g P · ${macros.carbs_g.toFixed(1)}g C · ${macros.fat_g.toFixed(1)}g F</span>
                    </div>
                </div>
                <button data-index="${index}" class="remove-search-item-btn" style="background: none; border: none; color: #dc3545; font-size: 1.25rem; cursor: pointer; padding: 0.25rem 0.5rem;">&times;</button>
            </div>
        `;
        }).join('');

        itemsEl.querySelectorAll('.item-grams-input').forEach((input) => {
            input.addEventListener('input', (e) => {
                this.updateItemGrams(parseInt(e.target.dataset.index, 10), e.target.value);
            });
        });

        itemsEl.querySelectorAll('.remove-search-item-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.removeItem(parseInt(btn.dataset.index, 10)));
        });

        this.updateTotal();
    },

    /**
     * Recompute and display the running total for the meal being built
     */
    updateTotal() {
        const totalEl = document.getElementById('search-meal-total');
        if (!totalEl) return;

        const totals = this.items.reduce((acc, item) => {
            const macros = this.computeMacros(item);
            return {
                calories: acc.calories + macros.calories,
                protein_g: acc.protein_g + macros.protein_g,
                carbs_g: acc.carbs_g + macros.carbs_g,
                fat_g: acc.fat_g + macros.fat_g,
            };
        }, { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

        totalEl.textContent = `Total: ${Math.round(totals.calories)} kcal · ${totals.protein_g.toFixed(1)}g P · ${totals.carbs_g.toFixed(1)}g C · ${totals.fat_g.toFixed(1)}g F`;
    },

    /**
     * Save the meal being built. Creates a new meal via POST /meals, or if
     * we're editing a past meal (activeMeal.isPastEdit), updates it in place
     * via PATCH /meals/{id} instead - same create-vs-update split as the
     * workout "Finish"/"Save" button.
     */
    async saveMeal() {
        if (this.items.length === 0) {
            alert('Add at least one food first.');
            return;
        }

        const nameInput = document.getElementById('meal-name-input');
        const dateInput = document.getElementById('meal-date-input');

        const payload = {
            name: nameInput ? (nameInput.value.trim() || undefined) : undefined,
            meal_date: dateInput ? (dateInput.value || undefined) : undefined,
            items: this.items.map((item) => {
                const macros = this.computeMacros(item);
                return {
                    id: item.id,
                    fdc_id: item.fdc_id,
                    name: item.name,
                    grams: item.grams,
                    calories: macros.calories,
                    protein_g: macros.protein_g,
                    carbs_g: macros.carbs_g,
                    fat_g: macros.fat_g,
                    serving_label: item.servingLabel || null,
                    serving_count: item.servingCount != null ? item.servingCount : null,
                };
            }),
        };

        try {
            if (activeMeal && activeMeal.isPastEdit) {
                await api.patch(`/meals/${activeMeal.id}`, payload);
                alert('Meal updated!');
            } else {
                await api.post('/meals', payload);
                alert(`Meal saved! ${this.items.length} food item(s).`);
            }
            this.closeMealBuilder();
            loadNutritionDiary();
            if (typeof today !== 'undefined') today.loadToday();
        } catch (error) {
            console.error('Error saving meal:', error);
            alert('Failed to save meal');
        }
    },

    /**
     * Load saved meal templates from GET /meal-templates. Always caches the
     * list (so it's ready the moment the picker modal opens); only renders
     * into the modal's list if the modal happens to be open already.
     */
    async loadMealTemplates() {
        try {
            this.templates = await api.get('/meal-templates');
            if (document.getElementById('template-picker-list')) {
                this.renderMealTemplates(this.templates);
            }
        } catch (error) {
            console.error('Error loading meal templates:', error);
        }
    },

    /**
     * Open the meal-template picker modal. Templates live entirely behind
     * this button/modal so they never take up space on the Food tab itself -
     * today's meals stay the first thing visible.
     */
    showTemplatePickerModal() {
        let modal = document.getElementById('template-picker-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'template-picker-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                z-index: 1000;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            modal.innerHTML = `
                <div style="background: white; border-radius: 12px; width: 90%; max-width: 400px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden;">
                    <div style="padding: 1rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0;">Meal Templates</h3>
                        <button id="template-picker-close-btn" style="background: none; border: none; font-size: 1.3rem; cursor: pointer; color: #666; line-height: 1;">&times;</button>
                    </div>
                    <div id="template-picker-list" style="padding: 0.75rem; overflow-y: auto; flex: 1;"></div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('template-picker-close-btn').addEventListener('click', () => this.hideTemplatePickerModal());
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hideTemplatePickerModal();
            });
        } else {
            modal.style.display = 'flex';
        }

        this.renderMealTemplates(this.templates);
    },

    hideTemplatePickerModal() {
        const modal = document.getElementById('template-picker-modal');
        if (modal) modal.style.display = 'none';
    },

    /**
     * Render the saved meal templates list into the picker modal
     */
    renderMealTemplates(templates) {
        const listEl = document.getElementById('template-picker-list');
        if (!listEl) return;

        if (!templates || templates.length === 0) {
            listEl.className = 'empty-state';
            listEl.innerHTML = 'No saved templates yet. Build a meal, then tap "Save as Template" to reuse it later.';
            return;
        }

        listEl.className = '';

        listEl.innerHTML = templates.map((template) => `
            <div class="history-card">
                <div class="history-card-header">
                    <span class="history-card-name">${this.escapeHtml(template.name)}</span>
                    <span>
                        <button class="history-menu-btn" onclick="foodSearch.editMealTemplate(${template.id})">✏️</button>
                        <button class="history-menu-btn" onclick="foodSearch.deleteMealTemplate(${template.id})">🗑️</button>
                    </span>
                </div>
                <div style="font-size: 0.85rem; color: #666; margin-bottom: 0.5rem;">
                    ${template.items.map((item) => this.escapeHtml(item.name)).join(', ')}
                </div>
                <div style="font-size: 0.85rem; font-weight: bold; margin-bottom: 0.5rem;">
                    ${Math.round(template.total_calories)} kcal · ${template.total_protein_g.toFixed(1)}g P · ${template.total_carbs_g.toFixed(1)}g C · ${template.total_fat_g.toFixed(1)}g F
                </div>
                <button class="btn" style="font-size: 0.85rem; padding: 0.5rem;" onclick="foodSearch.useMealTemplate(${template.id})">+ Log Today</button>
            </div>
        `).join('');
    },

    /**
     * Save the meal currently being built as a reusable template, so it can
     * be logged again later without re-searching for each item. Does not
     * itself log a meal for today - "Save Meal" does that separately.
     *
     * If activeTemplateEdit is set (opened via "Edit" on an existing
     * template), this updates that template in place instead of creating a
     * new one.
     */
    async saveAsTemplate() {
        if (this.items.length === 0) {
            alert('Add at least one food first.');
            return;
        }

        const nameInput = document.getElementById('meal-name-input');
        const defaultName = this.activeTemplateEdit
            ? this.activeTemplateEdit.name
            : (nameInput ? nameInput.value.trim() : '');
        const name = prompt('Name this template:', defaultName);
        if (!name || !name.trim()) return;

        const payload = {
            name: name.trim(),
            items: this.items.map((item) => {
                const macros = this.computeMacros(item);
                return {
                    fdc_id: item.fdc_id,
                    name: item.name,
                    grams: item.grams,
                    calories: macros.calories,
                    protein_g: macros.protein_g,
                    carbs_g: macros.carbs_g,
                    fat_g: macros.fat_g,
                    serving_label: item.servingLabel || null,
                    serving_count: item.servingCount != null ? item.servingCount : null,
                };
            }),
        };

        try {
            if (this.activeTemplateEdit) {
                await api.patch(`/meal-templates/${this.activeTemplateEdit.id}`, payload);
                alert('Template updated!');
                this.closeMealBuilder();
            } else {
                await api.post('/meal-templates', payload);
                alert('Template saved!');
            }
            this.loadMealTemplates();
        } catch (error) {
            console.error('Error saving template:', error);
            alert('Failed to save template');
        }
    },

    /**
     * Open the meal builder pre-filled with a saved template's items, dated
     * today, for review before saving - mirrors copyMealToToday(). The
     * template itself is untouched and stays available for reuse.
     */
    useMealTemplate(templateId) {
        const template = this.templates.find((t) => t.id === templateId);
        if (!template) return;

        this.hideTemplatePickerModal();

        activeMeal = null;
        this.activeTemplateEdit = null;

        this.items = template.items.map((item) => {
            const scale = item.grams > 0 ? item.grams / 100 : 1;
            return {
                fdc_id: item.fdc_id,
                name: item.name,
                grams: item.grams,
                per100: {
                    calories: (item.calories || 0) / scale,
                    protein_g: (item.protein_g || 0) / scale,
                    carbs_g: (item.carbs_g || 0) / scale,
                    fat_g: (item.fat_g || 0) / scale,
                },
                servingLabel: item.serving_label || null,
                servingCount: item.serving_count != null ? item.serving_count : null,
            };
        });

        const addMealCard = document.getElementById('add-meal-card');
        if (addMealCard) addMealCard.style.display = 'none';

        const section = document.getElementById('search-meal-section');
        if (section) section.style.display = 'block';

        const titleEl = document.getElementById('meal-builder-title');
        if (titleEl) titleEl.textContent = 'New Meal';

        const saveBtn = document.getElementById('save-search-meal-btn');
        if (saveBtn) saveBtn.textContent = 'Save Meal';

        const dateInput = document.getElementById('meal-date-input');
        if (dateInput) {
            const today = new Date();
            const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
            dateInput.value = localDate.toISOString().slice(0, 10);
        }

        const nameInput = document.getElementById('meal-name-input');
        if (nameInput) nameInput.value = template.name;

        this.setBuilderMode('meal');
        this.renderMeal();

        section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    /**
     * Open the meal builder to edit a template's own name/items in place
     * (not a dated log - "Update Template" saves back to the same template).
     */
    editMealTemplate(templateId) {
        const template = this.templates.find((t) => t.id === templateId);
        if (!template) return;

        this.hideTemplatePickerModal();

        activeMeal = null;
        this.activeTemplateEdit = { id: template.id, name: template.name };

        this.items = template.items.map((item) => {
            const scale = item.grams > 0 ? item.grams / 100 : 1;
            return {
                fdc_id: item.fdc_id,
                name: item.name,
                grams: item.grams,
                per100: {
                    calories: (item.calories || 0) / scale,
                    protein_g: (item.protein_g || 0) / scale,
                    carbs_g: (item.carbs_g || 0) / scale,
                    fat_g: (item.fat_g || 0) / scale,
                },
                servingLabel: item.serving_label || null,
                servingCount: item.serving_count != null ? item.serving_count : null,
            };
        });

        const addMealCard = document.getElementById('add-meal-card');
        if (addMealCard) addMealCard.style.display = 'none';

        const section = document.getElementById('search-meal-section');
        if (section) section.style.display = 'block';

        const titleEl = document.getElementById('meal-builder-title');
        if (titleEl) titleEl.textContent = 'Edit Template';

        const nameInput = document.getElementById('meal-name-input');
        if (nameInput) nameInput.value = template.name;

        this.setBuilderMode('template-edit');
        this.renderMeal();

        section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    /**
     * Delete a saved meal template
     */
    async deleteMealTemplate(templateId) {
        if (!confirm('Delete this template?')) return;

        try {
            await api.delete(`/meal-templates/${templateId}`);
            this.loadMealTemplates();
        } catch (error) {
            console.error('Error deleting template:', error);
            alert('Failed to delete template');
        }
    },

    /**
     * Format a date-only string (YYYY-MM-DD) for display. Parsed as local
     * calendar date components (not via `new Date(dateStr)`, which reads a
     * bare date as UTC midnight and can roll back a day in timezones behind UTC).
     */
    formatDate(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    },

    /**
     * Show meal menu (dropdown options) - same pattern as the workout menu (Edit/Delete)
     */
    showMealMenu(mealId, event) {
        event.stopPropagation();
        event.preventDefault();

        const menu = document.createElement('div');
        menu.style.cssText = `
            position: fixed;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            padding: 0.5rem;
            z-index: 1100;
            min-width: 160px;
        `;

        menu.innerHTML = `
            <button onclick="foodSearch.openHistoryMealEdit(${mealId}); this.closest('div').remove()" style="
                width: 100%;
                padding: 0.75rem;
                text-align: left;
                background: none;
                border: none;
                cursor: pointer;
                font-size: 0.9rem;
                color: #1a1a2e;
            ">Edit</button>
            <hr style="margin: 0.5rem 0; border: none; border-top: 1px solid #eee;">
            <button onclick="foodSearch.copyMealToToday(${mealId}); this.closest('div').remove()" style="
                width: 100%;
                padding: 0.75rem;
                text-align: left;
                background: none;
                border: none;
                cursor: pointer;
                font-size: 0.9rem;
                color: #1a1a2e;
            ">Copy to Today</button>
            <hr style="margin: 0.5rem 0; border: none; border-top: 1px solid #eee;">
            <button onclick="foodSearch.deleteMeal(${mealId}); this.closest('div').remove()" style="
                width: 100%;
                padding: 0.75rem;
                text-align: left;
                background: none;
                border: none;
                cursor: pointer;
                font-size: 0.9rem;
                color: #dc3545;
            ">Delete</button>
        `;

        // menu.style.position is 'fixed', which is already viewport-relative -
        // do NOT add window.scrollY/scrollX here, or the menu drifts further
        // off-screen the more the page has been scrolled.
        const rect = event.currentTarget.getBoundingClientRect();
        const top = rect.bottom;
        const left = rect.left;

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;

        document.body.appendChild(menu);

        // Close on click outside
        const closeMenu = function() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 10);
    },

    /**
     * Show history detail view for a meal - read-only
     */
    async showHistoryDetail(mealId) {
        try {
            const meal = await api.get(`/meals/${mealId}`);

            // Create panel container
            const panel = document.createElement('div');
            panel.className = 'meal-history-detail-panel';

            // Build meal name
            const mealName = (meal.name && meal.name.trim() !== '')
                ? meal.name
                : `Meal #${meal.id}`;

            const date = new Date(meal.meal_date);

            // Build food item rows
            let itemsHtml = '';
            if (meal.items && meal.items.length > 0) {
                itemsHtml = meal.items.map((item, idx) => {
                    const amountText = item.serving_label && item.serving_count != null
                        ? `${this.formatServingCount(item.serving_count)} ${item.serving_label}${item.serving_count === 1 ? '' : 's'}`
                        : `${item.grams} g`;
                    return `
                    <div class="meal-history-detail-food">
                        <div class="meal-history-detail-food-name">${this.escapeHtml(item.name)}</div>
                        <div class="meal-history-detail-food-grams">${this.escapeHtml(amountText)}</div>
                        <div class="meal-history-detail-food-macros">
                            ${Math.round(item.calories)} kcal · ${item.protein_g.toFixed(1)}g P · ${item.carbs_g.toFixed(1)}g C · ${item.fat_g.toFixed(1)}g F
                        </div>
                    </div>`;
                }).join('');
            } else {
                itemsHtml = '<p style="color: #999;">No food items in this meal.</p>';
            }

            panel.innerHTML = `
                <div class="meal-history-detail-header">
                    <button class="meal-history-detail-close" onclick="this.closest('.meal-history-detail-panel').remove()">×</button>
                    <div class="meal-history-detail-title">${mealName}</div>
                    <div class="meal-history-detail-actions">
                        <button onclick="foodSearch.copyMealToToday(${mealId}); this.closest('.meal-history-detail-panel').remove()" class="meal-history-detail-edit-btn" style="background: #1a1a2e;">Copy to Today</button>
                        <button onclick="foodSearch.openHistoryMealEdit(${mealId}); this.closest('.meal-history-detail-panel').remove()" class="meal-history-detail-edit-btn">Edit</button>
                    </div>
                </div>

                <div class="meal-history-detail-content">
                    <div class="meal-history-detail-date">${this.formatDate(meal.meal_date)}</div>

                    <div class="meal-history-detail-stats">
                        <div class="meal-history-detail-stat" title="Total Calories">
                            <span class="meal-history-detail-stat-icon">🔥</span>
                            <span class="meal-history-detail-stat-value">${Math.round(meal.total_calories)} kcal</span>
                        </div>
                        <div class="meal-history-detail-stat" title="Total Protein">
                            <span class="meal-history-detail-stat-icon">🍗</span>
                            <span class="meal-history-detail-stat-value">${meal.total_protein_g.toFixed(1)}g</span>
                        </div>
                        <div class="meal-history-detail-stat" title="Total Carbs">
                            <span class="meal-history-detail-stat-icon">🍞</span>
                            <span class="meal-history-detail-stat-value">${meal.total_carbs_g.toFixed(1)}g</span>
                        </div>
                        <div class="meal-history-detail-stat" title="Total Fat">
                            <span class="meal-history-detail-stat-icon">🧀</span>
                            <span class="meal-history-detail-stat-value">${meal.total_fat_g.toFixed(1)}g</span>
                        </div>
                    </div>

                    ${itemsHtml}
                </div>
            `;

            document.body.appendChild(panel);
        } catch (error) {
            console.error('Error loading meal detail:', error);
            alert('Failed to load meal details');
        }
    },

    /**
     * Open a past meal in the same builder UI used for adding a meal, so it
     * can be edited (portions, add/remove foods) - mirrors openHistoryWorkoutEdit.
     * Saving PATCHes this meal in place instead of creating a new one.
     */
    async openHistoryMealEdit(mealId) {
        try {
            const meal = await api.get(`/meals/${mealId}`);

            activeMeal = { id: meal.id, isPastEdit: true };
            this.activeTemplateEdit = null;

            // Copy items into foodSearch.items for editing. The API only
            // returns each item's final (grams-scaled) macros, so back out
            // the per-100g values here - renderMeal()/updateItemGrams() need
            // them to recompute live as the portion is edited.
            this.items = meal.items.map((item) => {
                const scale = item.grams > 0 ? item.grams / 100 : 1;
                return {
                    id: item.id,
                    fdc_id: item.fdc_id,
                    name: item.name,
                    grams: item.grams,
                    per100: {
                        calories: (item.calories || 0) / scale,
                        protein_g: (item.protein_g || 0) / scale,
                        carbs_g: (item.carbs_g || 0) / scale,
                        fat_g: (item.fat_g || 0) / scale,
                    },
                    servingLabel: item.serving_label || null,
                    servingCount: item.serving_count != null ? item.serving_count : null,
                };
            });

            // Hide the "Add Meal" entry point, show the builder section
            const addMealCard = document.getElementById('add-meal-card');
            if (addMealCard) addMealCard.style.display = 'none';

            const section = document.getElementById('search-meal-section');
            if (section) section.style.display = 'block';

            const titleEl = document.getElementById('meal-builder-title');
            if (titleEl) titleEl.textContent = 'Edit Meal';

            const saveBtn = document.getElementById('save-search-meal-btn');
            if (saveBtn) saveBtn.textContent = 'Save';

            // Set the meal date input to the meal's date (parsed as local
            // calendar components, same reasoning as formatDate())
            const dateInput = document.getElementById('meal-date-input');
            if (dateInput) dateInput.value = meal.meal_date;

            // Set the meal name field to the meal's existing name, verbatim
            const nameInput = document.getElementById('meal-name-input');
            if (nameInput) nameInput.value = meal.name || '';

            this.setBuilderMode('meal');
            this.renderMeal();

        } catch (error) {
            console.error('Error opening meal for editing:', error);
            alert('Failed to load meal');
        }
    },

    /**
     * Copy a past meal into the builder as a brand new meal dated today (e.g.
     * "I'm eating this again") - same builder as editing, but activeMeal
     * stays null so Save creates a new meal via POST instead of PATCHing the
     * original, and the date defaults to today rather than the original date.
     */
    async copyMealToToday(mealId) {
        try {
            const meal = await api.get(`/meals/${mealId}`);

            activeMeal = null;
            this.activeTemplateEdit = null;

            this.items = meal.items.map((item) => {
                const scale = item.grams > 0 ? item.grams / 100 : 1;
                return {
                    fdc_id: item.fdc_id,
                    name: item.name,
                    grams: item.grams,
                    per100: {
                        calories: (item.calories || 0) / scale,
                        protein_g: (item.protein_g || 0) / scale,
                        carbs_g: (item.carbs_g || 0) / scale,
                        fat_g: (item.fat_g || 0) / scale,
                    },
                    servingLabel: item.serving_label || null,
                    servingCount: item.serving_count != null ? item.serving_count : null,
                };
            });

            const addMealCard = document.getElementById('add-meal-card');
            if (addMealCard) addMealCard.style.display = 'none';

            const section = document.getElementById('search-meal-section');
            if (section) section.style.display = 'block';

            const titleEl = document.getElementById('meal-builder-title');
            if (titleEl) titleEl.textContent = 'New Meal';

            const saveBtn = document.getElementById('save-search-meal-btn');
            if (saveBtn) saveBtn.textContent = 'Save Meal';

            // Date defaults to today, not the original meal's date
            const dateInput = document.getElementById('meal-date-input');
            if (dateInput) {
                const today = new Date();
                const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
                dateInput.value = localDate.toISOString().slice(0, 10);
            }

            // Carry over the meal name from the original, verbatim
            const nameInput = document.getElementById('meal-name-input');
            if (nameInput) nameInput.value = meal.name || '';

            this.setBuilderMode('meal');
            this.renderMeal();

            section?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } catch (error) {
            console.error('Error copying meal:', error);
            alert('Failed to copy meal');
        }
    },

    /**
     * Delete a meal - same pattern as deleteWorkout
     */
    async deleteMeal(mealId) {
        if (!confirm('Are you sure you want to delete this meal?')) return;

        try {
            await api.delete(`/meals/${mealId}`);
            loadNutritionDiary();
            if (typeof today !== 'undefined') today.loadToday();
        } catch (error) {
            console.error('Error deleting meal:', error);
            alert('Failed to delete meal');
        }
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Expose foodSearch globally: inline onclick="foodSearch...." handlers in
// generated HTML (meal card, menu, detail panel) run in global scope and
// can't see this module-scoped const otherwise - same reason workout's
// history functions are assigned to window.* (e.g. window.showHistoryDetail).
window.foodSearch = foodSearch;

// ========== Weekly Check-in Functionality ==========
const checkin = {
    /** id of the check-in being edited, or null when adding a new one */
    activeCheckinId: null,

    /** Photo file selected for upload (kept in memory until Save) */
    pendingPhoto: null,

    init() {
        const addBtn = document.getElementById('add-checkin-btn');
        if (addBtn) addBtn.addEventListener('click', () => this.openForm());

        const saveBtn = document.getElementById('save-checkin-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveCheckin());

        const cancelBtn = document.getElementById('cancel-checkin-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeForm());

        const photoInput = document.getElementById('checkin-photo-input');
        if (photoInput) photoInput.addEventListener('change', (e) => this.handlePhotoSelect(e));

        this.loadCheckins();
    },

    /**
     * Open the form for a brand new check-in, resetting all fields and
     * defaulting the date to today.
     */
    openForm() {
        this.activeCheckinId = null;
        this.pendingPhoto = null;

        const addCard = document.getElementById('add-checkin-card');
        if (addCard) addCard.style.display = 'none';

        const section = document.getElementById('checkin-form-section');
        if (section) section.style.display = 'block';

        const titleEl = document.getElementById('checkin-form-title');
        if (titleEl) titleEl.textContent = 'New Check-in';

        const saveBtn = document.getElementById('save-checkin-btn');
        if (saveBtn) saveBtn.textContent = 'Save Check-in';

        ['checkin-weight-input', 'checkin-waist-input', 'checkin-chest-input',
         'checkin-hips-input', 'checkin-arm-input', 'checkin-thigh-input'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const notesEl = document.getElementById('checkin-notes-input');
        if (notesEl) notesEl.value = '';
        const photoInput = document.getElementById('checkin-photo-input');
        if (photoInput) photoInput.value = '';
        const previewEl = document.getElementById('checkin-photo-preview');
        if (previewEl) { previewEl.innerHTML = ''; previewEl.style.display = 'none'; }

        const dateInput = document.getElementById('checkin-date-input');
        if (dateInput) {
            const today = new Date();
            const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
            dateInput.value = localDate.toISOString().slice(0, 10);
        }
    },

    /**
     * Close the form without saving
     */
    closeForm() {
        this.activeCheckinId = null;
        this.pendingPhoto = null;

        const section = document.getElementById('checkin-form-section');
        if (section) section.style.display = 'none';

        const addCard = document.getElementById('add-checkin-card');
        if (addCard) addCard.style.display = 'block';
    },

    /**
     * Handle a selected/captured progress photo: keep it in memory (uploaded
     * only at Save time) and show a local preview.
     */
    handlePhotoSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.pendingPhoto = file;

        const previewEl = document.getElementById('checkin-photo-preview');
        if (previewEl) {
            previewEl.innerHTML = `<img src="${URL.createObjectURL(file)}" style="max-width: 100%; border-radius: 8px;">`;
            previewEl.style.display = 'block';
        }
    },

    /**
     * Save the check-in: POST for a new one, PATCH when editing. Reuses the
     * arrayBuffer-read upload workaround needed elsewhere for iOS Safari,
     * where a freshly-captured camera photo can otherwise upload as an
     * empty body.
     */
    async saveCheckin() {
        const formData = new FormData();

        const dateInput = document.getElementById('checkin-date-input');
        if (dateInput && dateInput.value) formData.append('checkin_date', dateInput.value);

        const fieldMap = {
            'checkin-weight-input': 'weight_kg',
            'checkin-waist-input': 'waist_cm',
            'checkin-chest-input': 'chest_cm',
            'checkin-hips-input': 'hips_cm',
            'checkin-arm-input': 'arm_cm',
            'checkin-thigh-input': 'thigh_cm',
        };
        for (const [elId, fieldName] of Object.entries(fieldMap)) {
            const el = document.getElementById(elId);
            if (el && el.value !== '') formData.append(fieldName, el.value);
        }

        const notesEl = document.getElementById('checkin-notes-input');
        if (notesEl && notesEl.value.trim() !== '') formData.append('notes', notesEl.value.trim());

        if (this.pendingPhoto) {
            const arrayBuffer = await this.pendingPhoto.arrayBuffer();
            const photoBlob = new Blob([arrayBuffer], { type: this.pendingPhoto.type || 'image/jpeg' });
            formData.append('photo', photoBlob, this.pendingPhoto.name || 'checkin.jpg');
        }

        try {
            const url = this.activeCheckinId
                ? `${window.location.origin}/checkins/${this.activeCheckinId}`
                : `${window.location.origin}/checkins`;
            const response = await fetch(url, {
                method: this.activeCheckinId ? 'PATCH' : 'POST',
                body: formData,
                cache: 'no-store',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            alert(this.activeCheckinId ? 'Check-in updated!' : 'Check-in saved!');
            this.closeForm();
            this.loadCheckins();
        } catch (error) {
            console.error('Error saving check-in:', error);
            alert('Failed to save check-in');
        }
    },

    /**
     * Load check-ins from GET /checkins and render them, most recent first
     */
    async loadCheckins() {
        const listEl = document.getElementById('checkin-list');
        if (!listEl) return;

        try {
            const checkins = await api.get('/checkins');
            this.renderCheckins(checkins);
        } catch (error) {
            console.error('Error loading check-ins:', error);
        }
    },

    /**
     * Render the check-in history list, with a weight delta vs. the
     * previous check-in when both have a recorded weight
     */
    renderCheckins(checkins) {
        const listEl = document.getElementById('checkin-list');
        if (!listEl) return;

        if (!checkins || checkins.length === 0) {
            listEl.className = 'empty-state';
            listEl.innerHTML = 'No check-ins logged yet.';
            return;
        }

        listEl.className = '';
        listEl.innerHTML = checkins.map((c, index) => {
            const previous = checkins[index + 1]; // list is most-recent-first
            let deltaHtml = '';
            if (c.weight_kg != null && previous && previous.weight_kg != null) {
                const delta = c.weight_kg - previous.weight_kg;
                const rounded = Math.round(Math.abs(delta) * 10) / 10;
                if (rounded > 0) {
                    const cls = delta < 0 ? 'checkin-delta-down' : 'checkin-delta-up';
                    const arrow = delta < 0 ? '▼' : '▲';
                    deltaHtml = `<span class="checkin-delta ${cls}">${arrow} ${rounded} kg since last check-in</span>`;
                } else {
                    deltaHtml = `<span class="checkin-delta">No change since last check-in</span>`;
                }
            }

            const photoHtml = c.photo_path
                ? `<img src="${this.escapeHtml(c.photo_path)}" class="checkin-card-photo">`
                : '';

            const statsParts = [];
            if (c.weight_kg != null) statsParts.push(`${c.weight_kg} kg`);
            if (c.waist_cm != null) statsParts.push(`waist ${c.waist_cm}cm`);
            if (c.chest_cm != null) statsParts.push(`chest ${c.chest_cm}cm`);
            if (c.hips_cm != null) statsParts.push(`hips ${c.hips_cm}cm`);
            if (c.arm_cm != null) statsParts.push(`arm ${c.arm_cm}cm`);
            if (c.thigh_cm != null) statsParts.push(`thigh ${c.thigh_cm}cm`);

            return `
                <div class="history-card" onclick="checkin.showDetail(${c.id})">
                    <div class="history-card-header">
                        <span class="history-card-name">${this.formatDate(c.checkin_date)}</span>
                        <button class="history-menu-btn" onclick="event.stopPropagation(); checkin.showMenu(${c.id}, event)">☰</button>
                    </div>
                    ${photoHtml}
                    <div style="font-size: 0.9rem; color: #333; margin-bottom: 0.25rem;">
                        ${statsParts.length > 0 ? this.escapeHtml(statsParts.join(' · ')) : '<span style="color:#999;">No measurements recorded</span>'}
                    </div>
                    ${deltaHtml}
                </div>
            `;
        }).join('');
    },

    /**
     * Format a date-only string (YYYY-MM-DD) as local calendar components,
     * avoiding the UTC-midnight rollback bug from `new Date(dateStr)`.
     */
    formatDate(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    },

    /**
     * Show the ☰ menu (Edit/Delete) - same pattern as the meal/workout menus
     */
    showMenu(checkinId, event) {
        event.stopPropagation();
        event.preventDefault();

        const menu = document.createElement('div');
        menu.style.cssText = `
            position: fixed;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            padding: 0.5rem;
            z-index: 1100;
            min-width: 160px;
        `;

        menu.innerHTML = `
            <button onclick="checkin.editCheckin(${checkinId}); this.closest('div').remove()" style="
                width: 100%; padding: 0.75rem; text-align: left; background: none;
                border: none; cursor: pointer; font-size: 0.9rem; color: #1a1a2e;
            ">Edit</button>
            <hr style="margin: 0.5rem 0; border: none; border-top: 1px solid #eee;">
            <button onclick="checkin.deleteCheckin(${checkinId}); this.closest('div').remove()" style="
                width: 100%; padding: 0.75rem; text-align: left; background: none;
                border: none; cursor: pointer; font-size: 0.9rem; color: #dc3545;
            ">Delete</button>
        `;

        // menu.style.position is 'fixed' (viewport-relative already) - do not
        // add window.scrollY/scrollX or the menu drifts off-screen when scrolled.
        const rect = event.currentTarget.getBoundingClientRect();
        menu.style.top = `${rect.bottom}px`;
        menu.style.left = `${rect.left}px`;

        document.body.appendChild(menu);

        const closeMenu = function() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 10);
    },

    /**
     * Show the read-only detail view for a check-in
     */
    async showDetail(checkinId) {
        try {
            const c = await api.get(`/checkins/${checkinId}`);

            const panel = document.createElement('div');
            panel.className = 'checkin-detail-panel';

            const statHtml = (label, value) => value != null
                ? `<div><div class="checkin-detail-stat-label">${label}</div><div class="checkin-detail-stat-value">${value}</div></div>`
                : '';

            panel.innerHTML = `
                <div class="checkin-detail-header">
                    <button class="checkin-detail-close" onclick="this.closest('.checkin-detail-panel').remove()">×</button>
                    <div class="checkin-detail-title">${this.formatDate(c.checkin_date)}</div>
                    <button onclick="checkin.editCheckin(${checkinId}); this.closest('.checkin-detail-panel').remove()" class="checkin-detail-edit-btn">Edit</button>
                </div>
                <div class="checkin-detail-content">
                    ${c.photo_path ? `<img src="${this.escapeHtml(c.photo_path)}" class="checkin-detail-photo">` : ''}
                    <div class="checkin-detail-stats">
                        ${statHtml('Weight', c.weight_kg != null ? `${c.weight_kg} kg` : null)}
                        ${statHtml('Waist', c.waist_cm != null ? `${c.waist_cm} cm` : null)}
                        ${statHtml('Chest', c.chest_cm != null ? `${c.chest_cm} cm` : null)}
                        ${statHtml('Hips', c.hips_cm != null ? `${c.hips_cm} cm` : null)}
                        ${statHtml('Arm', c.arm_cm != null ? `${c.arm_cm} cm` : null)}
                        ${statHtml('Thigh', c.thigh_cm != null ? `${c.thigh_cm} cm` : null)}
                    </div>
                    ${c.notes ? `<div class="checkin-detail-notes">${this.escapeHtml(c.notes)}</div>` : ''}
                </div>
            `;

            document.body.appendChild(panel);
        } catch (error) {
            console.error('Error loading check-in detail:', error);
            alert('Failed to load check-in');
        }
    },

    /**
     * Open a check-in in the form for editing, pre-filled with its current values
     */
    async editCheckin(checkinId) {
        try {
            const c = await api.get(`/checkins/${checkinId}`);

            this.activeCheckinId = c.id;
            this.pendingPhoto = null;

            const addCard = document.getElementById('add-checkin-card');
            if (addCard) addCard.style.display = 'none';

            const section = document.getElementById('checkin-form-section');
            if (section) section.style.display = 'block';

            const titleEl = document.getElementById('checkin-form-title');
            if (titleEl) titleEl.textContent = 'Edit Check-in';

            const saveBtn = document.getElementById('save-checkin-btn');
            if (saveBtn) saveBtn.textContent = 'Save';

            document.getElementById('checkin-date-input').value = c.checkin_date;
            document.getElementById('checkin-weight-input').value = c.weight_kg ?? '';
            document.getElementById('checkin-waist-input').value = c.waist_cm ?? '';
            document.getElementById('checkin-chest-input').value = c.chest_cm ?? '';
            document.getElementById('checkin-hips-input').value = c.hips_cm ?? '';
            document.getElementById('checkin-arm-input').value = c.arm_cm ?? '';
            document.getElementById('checkin-thigh-input').value = c.thigh_cm ?? '';
            document.getElementById('checkin-notes-input').value = c.notes || '';

            const photoInput = document.getElementById('checkin-photo-input');
            if (photoInput) photoInput.value = '';
            const previewEl = document.getElementById('checkin-photo-preview');
            if (previewEl) {
                if (c.photo_path) {
                    previewEl.innerHTML = `<img src="${this.escapeHtml(c.photo_path)}" style="max-width: 100%; border-radius: 8px;"><p style="font-size: 0.8rem; color: #666; margin-top: 0.25rem;">Current photo - pick a new file to replace it</p>`;
                    previewEl.style.display = 'block';
                } else {
                    previewEl.innerHTML = '';
                    previewEl.style.display = 'none';
                }
            }

            section?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } catch (error) {
            console.error('Error opening check-in for editing:', error);
            alert('Failed to load check-in');
        }
    },

    /**
     * Delete a check-in - same pattern as deleteMeal/deleteWorkout
     */
    async deleteCheckin(checkinId) {
        if (!confirm('Are you sure you want to delete this check-in?')) return;

        try {
            await api.delete(`/checkins/${checkinId}`);
            this.loadCheckins();
        } catch (error) {
            console.error('Error deleting check-in:', error);
            alert('Failed to delete check-in');
        }
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Expose globally for inline onclick="checkin...." handlers (see foodSearch
// for why - module-scoped consts aren't visible from global-scope attributes)
window.checkin = checkin;

// ========== Today Tab Functionality ==========
const today = {
    /** Most recently loaded active goal (or all-null shape if none set) */
    currentGoal: null,

    init() {
        const editBtn = document.getElementById('edit-goal-btn');
        if (editBtn) editBtn.addEventListener('click', () => this.openGoalForm());

        const saveBtn = document.getElementById('save-goal-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveGoal());

        const cancelBtn = document.getElementById('cancel-goal-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeGoalForm());

        this.loadToday();
    },

    /**
     * Load the active goal, all meals, and all workouts, then compute and
     * render today's/this week's totals against the goal. Reuses the
     * existing GET /meals and GET /workouts endpoints and filters
     * client-side rather than adding a dedicated backend aggregation route.
     */
    async loadToday() {
        try {
            const [goal, meals, workouts] = await Promise.all([
                api.get('/goal'),
                api.get('/meals'),
                api.get('/workouts'),
            ]);
            this.currentGoal = goal;
            this.render(goal, meals, workouts);
        } catch (error) {
            console.error('Error loading today overview:', error);
        }
    },

    /** Today's date as YYYY-MM-DD in local time, matching meal_date's format */
    todayString() {
        const now = new Date();
        const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
    },

    /** Local YYYY-MM-DD for an arbitrary date/datetime input */
    localDateStr(dateInput) {
        const d = new Date(dateInput);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    /** Midnight (local) of the Monday starting the current calendar week */
    weekStart() {
        const now = new Date();
        const day = now.getDay(); // 0 = Sunday
        const diffToMonday = (day === 0) ? 6 : day - 1;
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    },

    render(goal, meals, workouts) {
        const todayStr = this.todayString();

        // --- Nutrition: today's meals vs goal ---
        const todaysMeals = (meals || []).filter((m) => m.meal_date === todayStr);
        const totalCalories = todaysMeals.reduce((sum, m) => sum + (m.total_calories || 0), 0);
        const totalProtein = todaysMeals.reduce((sum, m) => sum + (m.total_protein_g || 0), 0);
        const totalCarbs = todaysMeals.reduce((sum, m) => sum + (m.total_carbs_g || 0), 0);
        const totalFat = todaysMeals.reduce((sum, m) => sum + (m.total_fat_g || 0), 0);

        document.getElementById('calories-consumed').textContent = Math.round(totalCalories);
        document.getElementById('calories-goal').textContent =
            goal.calorie_target != null ? Math.round(goal.calorie_target) : 'Not set';

        document.getElementById('protein-progress').textContent = goal.protein_target_g != null
            ? `${totalProtein.toFixed(1)}g / ${goal.protein_target_g}g`
            : `${totalProtein.toFixed(1)}g`;
        document.getElementById('carbs-progress').textContent = goal.carb_target_g != null
            ? `${totalCarbs.toFixed(1)}g / ${goal.carb_target_g}g`
            : `${totalCarbs.toFixed(1)}g`;
        document.getElementById('fat-progress').textContent = goal.fat_target_g != null
            ? `${totalFat.toFixed(1)}g / ${goal.fat_target_g}g`
            : `${totalFat.toFixed(1)}g`;

        // --- Exercise: today's duration + this week's workout count vs goal ---
        const todaysWorkouts = (workouts || []).filter((w) => this.localDateStr(w.started_at) === todayStr);
        const totalDurationSec = todaysWorkouts.reduce((sum, w) => sum + (w.duration_seconds || 0), 0);
        document.getElementById('exercise-duration').textContent = `${Math.round(totalDurationSec / 60)} min`;

        const weekStartDate = this.weekStart();
        const thisWeeksWorkouts = (workouts || []).filter((w) => new Date(w.started_at) >= weekStartDate);
        document.getElementById('training-days-progress').textContent = goal.training_days_per_week != null
            ? `${thisWeeksWorkouts.length} / ${goal.training_days_per_week} workouts`
            : `${thisWeeksWorkouts.length} workouts`;

        this.renderGoalSummary(goal);
    },

    /**
     * Render a plain-language summary of the active goal, or an empty state
     */
    renderGoalSummary(goal) {
        const summaryEl = document.getElementById('goal-summary');
        if (!summaryEl) return;

        const parts = [];
        if (goal.calorie_target != null) parts.push(`${Math.round(goal.calorie_target)} kcal/day`);
        if (goal.protein_target_g != null) parts.push(`${goal.protein_target_g}g protein`);
        if (goal.carb_target_g != null) parts.push(`${goal.carb_target_g}g carbs`);
        if (goal.fat_target_g != null) parts.push(`${goal.fat_target_g}g fat`);
        if (goal.training_days_per_week != null) parts.push(`train ${goal.training_days_per_week}x/week`);
        if (goal.target_weight_kg != null) {
            parts.push(`target weight ${goal.target_weight_kg}kg${goal.target_date ? ` by ${this.formatDate(goal.target_date)}` : ''}`);
        }

        if (parts.length === 0) {
            summaryEl.className = 'empty-state';
            summaryEl.innerHTML = 'No goal set yet.';
        } else {
            summaryEl.className = '';
            summaryEl.innerHTML = parts.map((p) => this.escapeHtml(p)).join('<br>');
        }
    },

    /**
     * Open the goal form, pre-filled with the currently active goal (if any)
     */
    openGoalForm() {
        const goal = this.currentGoal || {};
        document.getElementById('goal-calories-input').value = goal.calorie_target ?? '';
        document.getElementById('goal-protein-input').value = goal.protein_target_g ?? '';
        document.getElementById('goal-carbs-input').value = goal.carb_target_g ?? '';
        document.getElementById('goal-fat-input').value = goal.fat_target_g ?? '';
        document.getElementById('goal-training-days-input').value = goal.training_days_per_week ?? '';
        document.getElementById('goal-target-weight-input').value = goal.target_weight_kg ?? '';
        document.getElementById('goal-target-date-input').value = goal.target_date || '';

        const section = document.getElementById('goal-form-section');
        if (section) {
            section.style.display = 'block';
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

    closeGoalForm() {
        const section = document.getElementById('goal-form-section');
        if (section) section.style.display = 'none';
    },

    /**
     * Save the goal via PUT /goal (full replace - always sends every field,
     * since the form is always pre-filled from the current goal before
     * editing, nothing gets silently cleared).
     */
    async saveGoal() {
        const toNumOrNull = (id) => {
            const el = document.getElementById(id);
            if (!el || el.value === '') return null;
            const v = parseFloat(el.value);
            return isNaN(v) ? null : v;
        };
        const toIntOrNull = (id) => {
            const el = document.getElementById(id);
            if (!el || el.value === '') return null;
            const v = parseInt(el.value, 10);
            return isNaN(v) ? null : v;
        };
        const dateEl = document.getElementById('goal-target-date-input');

        const payload = {
            calorie_target: toNumOrNull('goal-calories-input'),
            protein_target_g: toNumOrNull('goal-protein-input'),
            carb_target_g: toNumOrNull('goal-carbs-input'),
            fat_target_g: toNumOrNull('goal-fat-input'),
            training_days_per_week: toIntOrNull('goal-training-days-input'),
            target_weight_kg: toNumOrNull('goal-target-weight-input'),
            target_date: dateEl && dateEl.value ? dateEl.value : null,
        };

        try {
            const goal = await api.put('/goal', payload);
            this.currentGoal = goal;
            this.closeGoalForm();
            this.loadToday();
        } catch (error) {
            console.error('Error saving goal:', error);
            alert('Failed to save goal');
        }
    },

    /**
     * Format a date-only string (YYYY-MM-DD) as local calendar components,
     * avoiding the UTC-midnight rollback bug from `new Date(dateStr)`.
     */
    formatDate(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

window.today = today;

// Format a date-only string (YYYY-MM-DD) for compact chart labels, e.g. "Aug 5".
// Parsed as local calendar components (same reasoning as foodSearch.formatDate).
function formatShortDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Hand-rolled inline SVG line chart, shared by the Progress tab's weight,
// calories, and strength charts. points: [{date, value}], sorted ascending.
// options.referenceValue draws a dashed goal/target line.
function progressLineChartSvg(points, options = {}) {
    const { unit = '', referenceValue = null, referenceLabel = '', color = '#e94560' } = options;
    const width = 600;
    const height = 200;
    const padX = 40;
    const padY = 30;

    const values = points.map((p) => p.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (referenceValue != null) {
        min = Math.min(min, referenceValue);
        max = Math.max(max, referenceValue);
    }
    if (min === max) {
        min -= 1;
        max += 1;
    }
    const range = max - min;

    const x = (i) => (points.length > 1 ? padX + (i / (points.length - 1)) * (width - padX * 2) : width / 2);
    const y = (v) => height - padY - ((v - min) / range) * (height - padY * 2);

    const linePoints = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
    const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${color}"/>`).join('');

    const firstLabel = `<text x="${x(0)}" y="${y(points[0].value) - 12}" fill="#888" font-size="12" text-anchor="middle">${points[0].value}${unit}</text>`;
    const lastLabel = points.length > 1
        ? `<text x="${x(points.length - 1)}" y="${y(points[points.length - 1].value) - 12}" fill="#1a1a2e" font-size="12" font-weight="600" text-anchor="middle">${points[points.length - 1].value}${unit}</text>`
        : '';

    const referenceLine = referenceValue != null
        ? `<line x1="${padX}" y1="${y(referenceValue)}" x2="${width - padX}" y2="${y(referenceValue)}" stroke="#999" stroke-width="1" stroke-dasharray="4,4"/>
           <text x="${width - padX}" y="${y(referenceValue) - 6}" fill="#999" font-size="11" text-anchor="end">${referenceLabel} ${referenceValue}${unit}</text>`
        : '';

    const dateLabels = `
        <text x="${padX}" y="${height - 6}" fill="#888" font-size="11" text-anchor="start">${formatShortDate(points[0].date)}</text>
        ${points.length > 1 ? `<text x="${width - padX}" y="${height - 6}" fill="#888" font-size="11" text-anchor="end">${formatShortDate(points[points.length - 1].date)}</text>` : ''}
    `;

    return `
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
            ${referenceLine}
            <polyline points="${linePoints}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${dots}
            ${firstLabel}
            ${lastLabel}
            ${dateLabels}
        </svg>
    `;
}

const progress = {
    init() {
        const exerciseSelect = document.getElementById('progress-exercise-select');
        if (exerciseSelect) {
            exerciseSelect.addEventListener('change', () => {
                this.loadStrengthChart(exerciseSelect.value);
            });
        }
    },

    /**
     * Load/refresh all three Progress tab charts. Called on tab switch.
     */
    load() {
        this.loadWeightChart();
        this.loadCaloriesChart();
        this.populateExerciseSelect();
    },

    async loadWeightChart() {
        const container = document.getElementById('progress-weight-chart');
        if (!container) return;

        try {
            const [checkins, goal] = await Promise.all([
                api.get('/checkins'),
                api.get('/goal').catch(() => null),
            ]);

            const points = checkins
                .filter((c) => c.weight_kg != null)
                .map((c) => ({ date: c.checkin_date, value: c.weight_kg }))
                .sort((a, b) => a.date.localeCompare(b.date));

            if (points.length === 0) {
                container.className = 'empty-state';
                container.innerHTML = 'Not enough check-in data yet.';
                return;
            }

            container.className = '';
            container.innerHTML = progressLineChartSvg(points, {
                unit: ' kg',
                referenceValue: goal && goal.target_weight_kg != null ? goal.target_weight_kg : null,
                referenceLabel: 'Goal',
            });
        } catch (error) {
            console.error('Error loading weight chart:', error);
        }
    },

    async loadCaloriesChart() {
        const container = document.getElementById('progress-calories-chart');
        if (!container) return;

        try {
            const [meals, goal] = await Promise.all([
                api.get('/meals'),
                api.get('/goal').catch(() => null),
            ]);

            const byDate = {};
            meals.forEach((m) => {
                byDate[m.meal_date] = (byDate[m.meal_date] || 0) + m.total_calories;
            });

            const points = Object.keys(byDate)
                .sort()
                .slice(-30)
                .map((date) => ({ date, value: Math.round(byDate[date]) }));

            if (points.length === 0) {
                container.className = 'empty-state';
                container.innerHTML = 'Not enough meal data yet.';
                return;
            }

            container.className = '';
            container.innerHTML = progressLineChartSvg(points, {
                unit: ' kcal',
                referenceValue: goal && goal.calorie_target != null ? goal.calorie_target : null,
                referenceLabel: 'Target',
            });
        } catch (error) {
            console.error('Error loading calories chart:', error);
        }
    },

    /**
     * Fill the exercise dropdown with only exercises actually logged in a
     * workout (not the full pickable list, which includes things never
     * done), merged by base name (e.g. "Romanian Deadlift" and "Romanian
     * Deadlift (Barbell)" count as one) and sorted by how many times each
     * has been logged, most-frequent first.
     */
    async populateExerciseSelect() {
        const select = document.getElementById('progress-exercise-select');
        if (!select) return;

        try {
            const logged = await api.get('/exercises/logged');
            const current = select.value;
            select.innerHTML = '<option value="">Select an exercise…</option>' +
                logged.map((g) => `<option value="${this.escapeHtml(g.name)}">${this.escapeHtml(g.name)} (${g.count}×)</option>`).join('');
            if (current) select.value = current;
        } catch (error) {
            console.error('Error loading logged exercises:', error);
        }
    },

    async loadStrengthChart(exerciseName) {
        const container = document.getElementById('progress-strength-chart');
        if (!container) return;

        if (!exerciseName) {
            container.className = 'empty-state';
            container.innerHTML = 'Pick an exercise to see its progression.';
            return;
        }

        try {
            const data = await api.get(`/exercises/progress?name=${encodeURIComponent(exerciseName)}`);
            const points = data.map((p) => ({ date: p.date, value: p.weight_kg }));

            if (points.length === 0) {
                container.className = 'empty-state';
                container.innerHTML = `No weighted sets logged yet for ${this.escapeHtml(exerciseName)}.`;
                return;
            }

            container.className = '';
            container.innerHTML = progressLineChartSvg(points, { unit: ' kg' });
        } catch (error) {
            console.error('Error loading strength chart:', error);
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
};

window.progress = progress;

window.loadNutritionDiary = loadNutritionDiary;


// ========== Nutrition Diary (grouped by day) — this IS the saved meals view ==========

/**
 * Load meals grouped by day from GET /nutrition/by-day and render them as
 * collapsible day cards, most recent day first. Replaces the old flat
 * saved-meals list.
 */
async function loadNutritionDiary() {
    const container = document.getElementById('diary-list');
    if (!container) return;

    try {
        const days = await api.get('/nutrition/by-day');
        renderNutritionDiary(days);
    } catch (error) {
        console.error('Error loading nutrition diary:', error);
        container.className = 'empty-state';
        container.innerHTML = 'Failed to load nutrition diary. Please try again.';
    }
}

function renderNutritionDiary(days) {
    const container = document.getElementById('diary-list');
    if (!container) return;

    if (!days || days.length === 0) {
        container.className = 'empty-state';
        container.innerHTML = 'No meals logged yet.';
        return;
    }

    container.className = '';
    container.innerHTML = days.map(day => createDayCard(day)).join('');
}

// One decimal place everywhere, per SPEC: "1843.0 kcal", "142.5 g protein"
function formatMacro(value) {
    return (value || 0).toFixed(1);
}

function createDayCard(day) {
    const dateObj = new Date(day.date + 'T00:00:00Z');
    const formattedDate = dateObj.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC'
    });

    return `
        <div class="day-card" data-date="${day.date}">
            <div class="day-card-header">
                <span class="day-card-date">${formattedDate}</span>
                <span class="day-card-toggle">▼</span>
            </div>
            ${createDayTotals(day.daily_totals)}
            <div class="day-card-body">
                <div class="day-card-meals">
                    ${day.meals.map(meal => createMealCard(meal)).join('')}
                </div>
            </div>
        </div>
    `;
}

function createDayTotals(totals) {
    return `
        <div class="day-card-macros">
            <div class="day-card-macro">
                <span class="day-card-macro-label">Cal</span>
                <span class="day-card-macro-value">${formatMacro(totals.calories)} kcal</span>
            </div>
            <div class="day-card-macro">
                <span class="day-card-macro-label">P</span>
                <span class="day-card-macro-value">${formatMacro(totals.protein_g)}g</span>
            </div>
            <div class="day-card-macro">
                <span class="day-card-macro-label">C</span>
                <span class="day-card-macro-value">${formatMacro(totals.carbs_g)}g</span>
            </div>
            <div class="day-card-macro">
                <span class="day-card-macro-label">F</span>
                <span class="day-card-macro-value">${formatMacro(totals.fat_g)}g</span>
            </div>
        </div>
    `;
}

function createMealCard(meal) {
    const itemsHtml = meal.items.length > 0
        ? meal.items.map(item => `
            <div class="day-card-food">
                ${escapeHtml(item.name)}
                <span class="day-card-food-grams">${item.grams}g</span>
            </div>
        `).join('')
        : '<p style="color: #999; font-size: 0.85rem;">No food items.</p>';

    return `
        <div class="day-card-meal">
            <div class="day-card-meal-header">
                <span class="day-card-meal-name">${escapeHtml(meal.name)}</span>
                <button class="history-menu-btn" onclick="event.stopPropagation(); foodSearch.showMealMenu(${meal.id}, event)">☰</button>
            </div>
            <div class="day-card-meal-macros">
                ${formatMacro(meal.total_calories)} kcal · ${formatMacro(meal.total_protein_g)}g P · ${formatMacro(meal.total_carbs_g)}g C · ${formatMacro(meal.total_fat_g)}g F
            </div>
            ${itemsHtml}
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize day card toggles
document.addEventListener('click', (e) => {
    const header = e.target.closest('.day-card-header');
    if (header) {
        const card = header.closest('.day-card');
        if (card) {
            e.preventDefault();
            card.classList.toggle('expanded');
        }
    }
});

// ========== Service Worker registration (if supported)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered:', registration.scope);
            })
            .catch(error => {
                console.error('SW registration failed:', error);
            });
    });
}