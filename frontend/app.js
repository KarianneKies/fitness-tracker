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

// Timer functionality for active workout
const timer = {
    intervalId: null,
    seconds: 0,
    
    start() {
        this.stop();
        this.intervalId = setInterval(() => {
            this.seconds++;
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
        this.seconds = 0;
        updateTimerDisplay(0);
    },
    
    getFormattedTime() {
        const mins = Math.floor(this.seconds / 60);
        const secs = this.seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
};

// Active workout state
let activeWorkout = null;
let exercisesData = [];
let currentExerciseNameFilter = '';

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

// Filter exercises based on search term
function filterExercises(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return exerciseList;
    
    // First check for exact/partial matches
    const matches = exerciseList.filter(ex => 
        ex.toLowerCase().includes(term)
    );
    
    if (matches.length > 0) {
        return matches;
    }
    
    // If no match, show custom exercise option
    if (term.length > 0) {
        return [`Custom: "${searchTerm}"`];
    }
    
    return [];
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
    
    const filtered = filterExercises(currentExerciseNameFilter);
    
    if (filtered.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #888;">No exercises found</p>';
        return;
    }
    
    list.innerHTML = filtered.map(exercise => `
        <div class="card" style="cursor: pointer; margin-bottom: 0.5rem;">
            <div onclick="selectExercise('${exercise.replace(/'/g, "\\'")}')">
                <strong>${exercise}</strong>
            </div>
        </div>
    `).join('');
}

// Select an exercise from picker
window.selectExercise = function(exerciseName) {
    const modal = document.getElementById('exercise-picker-modal');
    
    if (exerciseName.startsWith('Custom:')) {
        exerciseName = exerciseName.replace('Custom: "', '').replace('"', '');
    }
    
    // Check if we're replacing an existing exercise
    const replaceIndex = modal.dataset.replaceIndex;
    
    // Add to active workout
    if (activeWorkout && exerciseName) {
        const newExercise = {
            id: null,
            workout_id: activeWorkout.id,
            name: exerciseName,
            order: exercisesData.length + 1,
            sets: []
        };
        
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
                    })
                    .catch(err => {
                        console.error('Error saving replacement:', err);
                        alert('Failed to save exercise');
                    });
            }
        } else {
            // Add new exercise
            exercisesData.push(newExercise);
            
            console.log('Before save:', exercisesData.length, 'exercises');
            
            // Save to backend immediately
            saveExerciseToBackend(newExercise, true)
                .then(savedExercise => {
                    console.log('Saved exercise:', savedExercise);
                    // Replace temp exercise with saved one - create a copy to avoid reference issues
                    const tempIndex = exercisesData.findIndex(ex => !ex.id);
                    console.log('Temp index found:', tempIndex);
                    if (tempIndex !== -1) {
                        // Make a deep copy of the saved exercise to avoid reference issues
                        exercisesData[tempIndex] = JSON.parse(JSON.stringify(savedExercise));
                        console.log('After replace:', exercisesData);
                        renderExercises();
                    }
                })
                .catch(err => {
                    console.error('Error saving exercise:', err);
                    alert('Failed to save exercise');
                });
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
            return `
        <div class="card" data-exercise-id="${exercise.id || 'temp'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}" data-internal-index="${exIndex}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong>${exercise.name}</strong>
                ${!exercise.id ? '<span style="font-size: 0.8rem; color: #888;">(unsaved)</span>' : ''}
            </div>
            
            <table class="set-table" style="width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.85rem;">
                <thead>
                    <tr style="border-bottom: 1px solid #eee;">
                        <th style="text-align: left; padding: 0.5rem; width: 12%;">Set</th>
                        <th style="text-align: left; padding: 0.5rem; width: 12%;">Previous</th>
                        <th style="text-align: left; padding: 0.5rem; width: 20%;">kg</th>
                        <th style="text-align: left; padding: 0.5rem; width: 20%;">Reps</th>
                        <th style="text-align: center; padding: 0.5rem; width: 12%;">✓</th>
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
        
        // For active workouts: show inputs + checkbox + bin icon
        if (!isLocked) {
            return `
            <tr data-set-id="${set.id || 'temp-set-' + (setIndex + 1)}" class="${set.completed ? 'completed-set' : ''}">
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                    <span style="color: ${set.completed ? '#28a745' : '#666'}; font-weight: ${set.completed ? 'bold' : 'normal'};">Set ${setIndex + 1}</span>
                </td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                    <span style="color: #999;">—</span>
                </td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                    <input type="number" class="set-weight" data-set-index="${setIndex}" value="${weightVal}" placeholder="kg" min="0" step="0.5" style="width: 100%; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;" oninput="syncSetInputToState(${exIndex}, ${setIndex}, 'weight_kg', this.value)">
                </td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                    <input type="number" class="set-reps" data-set-index="${setIndex}" value="${repsVal}" placeholder="reps" min="1" style="width: 100%; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;" oninput="syncSetInputToState(${exIndex}, ${setIndex}, 'reps', this.value)">
                </td>
                 <td style="padding: 0.5rem; border-bottom: 1px solid #eee; text-align: center;">
                    <label style="cursor: pointer; display: flex; align-items: center; justify-content: center; width: 100%;">
                        <input type="checkbox" class="set-checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${set.completed ? 'checked' : ''} onchange="toggleSetCompleted(${exIndex}, ${setIndex}, this)">
                    </label>
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
                <span style="color: #999;">—</span>
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
        completed: false
    };
    
    if (!exercise.sets) exercise.sets = [];
    exercise.sets.push(newSet);
    
    // Re-render all exercises
    renderExercises();
};

// Toggle set checkbox - marks set as completed/not completed (frontend only)
window.toggleSetCompleted = function(exerciseIndex, setIndex, checkbox) {
    const exercise = exercisesData[exerciseIndex];
    if (!exercise) return;
    
    // Find the row using the current DOM structure - use tbody by its index-based ID
    const tbodyId = `sets-${exerciseIndex}`;
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    
    const allRows = tbody.querySelectorAll('tr');
    if (setIndex >= allRows.length) return;
    
    const row = allRows[setIndex];
    if (!row) return;
    
    // Toggle the completed class for visual styling
    if (checkbox.checked) {
        row.classList.add('completed-set');
        // Update local state
        if (exercise.sets && exercise.sets[setIndex]) {
            exercise.sets[setIndex].completed = true;
        }
    } else {
        row.classList.remove('completed-set');
        if (exercise.sets && exercise.sets[setIndex]) {
            exercise.sets[setIndex].completed = false;
        }
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

// Remove exercise from workout
window.removeExercise = function(exerciseIndex) {
    console.log('removeExercise called with index:', exerciseIndex);
    
    const exercise = exercisesData[exerciseIndex];
    
    if (!exercise) {
        console.log('Exercise not found at index:', exerciseIndex);
        return;
    }
    
    // If it's a new exercise (no ID), just remove from local state
    if (!exercise.id) {
        console.log('Removing temp exercise');
        exercisesData.splice(exerciseIndex, 1);
        renderExercises();
        console.log('After removal, exercisesData length:', exercisesData.length);
        return;
    }
    
    // If it's a saved exercise, remove from local state
    // Backend doesn't have delete endpoint for individual exercises,
    // so this just removes from display. The exercise will remain in database.
    console.log('Removing saved exercise');
    exercisesData.splice(exerciseIndex, 1);
    renderExercises();
    console.log('After removal, exercisesData length:', exercisesData.length);
    
    // Note: To fully remove from database, you'd need to finish the workout
    // or use a PATCH to rebuild exercises list without this one.
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

// Initialize workout on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Fitness Tracker App initialized');
    
    // Initialize tabs
    initTabs();
    
    // Start new workout button
    const startWorkoutBtn = document.getElementById('start-new-workout');
    if (startWorkoutBtn) {
        startWorkoutBtn.addEventListener('click', async () => {
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
                
                // Start the timer
                timer.start();
                
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
                
                console.log('New workout started, activeWorkout:', activeWorkout);
                
            } catch (error) {
                console.error('Error starting workout:', error);
                alert('Failed to start workout');
            }
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

                // Reset active workout state
                activeWorkout = null;
                exercisesData = [];
                
                // Hide active workout section, show start button
                document.getElementById('active-workout-section').style.display = 'none';
                document.getElementById('start-workout-section').style.display = 'block';
                
                // Reset timer
                timer.reset();
                
                let message = `Workout finished! Duration: ${timer.getFormattedTime()}\n\nAll sets have been saved. You can edit past workouts using the "Edit" button in the History tab.`;
                
                alert(message);
                
                // Reload workouts list
                loadWorkouts();
                
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
        
        const rect = event.currentTarget.getBoundingClientRect();
        const top = rect.bottom + window.scrollY;
        const left = rect.left + window.scrollX;
        
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

// Service Worker registration (if supported)
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