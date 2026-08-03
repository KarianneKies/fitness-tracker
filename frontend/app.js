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
    
    // Initialize food photo analysis functionality
    if (typeof foodPhoto !== 'undefined' && foodPhoto.init) {
        foodPhoto.init();
    }

    // Initialize manual food search functionality
    if (typeof foodSearch !== 'undefined' && foodSearch.init) {
        foodSearch.init();
    }

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

// ========== Food Photo Analysis Functionality ==========
const foodPhoto = {
    /** Current photo data being processed */
    currentPhoto: null,
    
    /** Current analysis results */
    results: [],
    
    /**
     * Initialize food photo capture functionality
     */
    init() {
        // Capture button
        const captureBtn = document.getElementById('capture-photo-btn');
        if (captureBtn) {
            captureBtn.addEventListener('click', () => this.startCamera());
        }
        
        // Photo input change handler
        const photoInput = document.getElementById('photo-input');
        if (photoInput) {
            photoInput.addEventListener('change', async (e) => await this.handleFileSelect(e));
        }
        
        // Clear results button
        const clearBtn = document.getElementById('clear-results-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearResults());
        }
        
        // Save meal button
        const saveBtn = document.getElementById('save-meal-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveMeal());
        }
        
        // Stop camera when switching away from Food tab
        document.addEventListener('tabSwitch', () => this.stopCamera());
    },
    
    /**
     * Start camera for real-time capture
     */
    async startCamera() {
        try {
            // Stop any existing camera stream
            this.stopCamera();
            
            // Request camera access
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' } // Use back camera on mobile
            });
            
            this.cameraStream = stream;
            
            // Create video element for preview (hidden)
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();
            
            // Create a canvas to capture the image
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            
            // Show capture UI overlay
            this.showCaptureOverlay(canvas, video);
            
        } catch (error) {
            console.error('Error accessing camera:', error);
            alert('Could not access camera. Please allow camera permissions and try again.');
        }
    },
    
    /**
     * Stop the camera
     */
    stopCamera() {
        if (this.cameraStream) {
            this.cameraStream.getTracks().forEach(track => track.stop());
            this.cameraStream = null;
        }
        
        // Remove capture overlay if it exists
        const overlay = document.getElementById('camera-overlay');
        if (overlay) {
            overlay.remove();
        }
    },
    
    /**
     * Show capture overlay with camera preview
     */
    showCaptureOverlay(canvas, video) {
        // Remove existing overlay if present
        const existing = document.getElementById('camera-overlay');
        if (existing) existing.remove();
        
        // Create overlay container
        const overlay = document.createElement('div');
        overlay.id = 'camera-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.95);
            z-index: 2000;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        `;
        
        // Video preview container
        const videoContainer = document.createElement('div');
        videoContainer.style.cssText = 'width: 100%; max-width: 600px; margin-bottom: 1rem;';
        
        // Create visible video element
        const previewVideo = document.createElement('video');
        previewVideo.autoplay = true;
        previewVideo.playsInline = true;
        previewVideo.srcObject = this.cameraStream;
        previewVideo.style.cssText = 'width: 100%; border-radius: 12px; transform: scaleX(-1);';
        
        // For Safari compatibility
        if (previewVideo.play) {
            previewVideo.play().catch(e => console.log('Preview play error:', e));
        }
        
        videoContainer.appendChild(previewVideo);
        
        // Capture button container
        const captureContainer = document.createElement('div');
        captureContainer.style.cssText = 'display: flex; gap: 1rem; margin-top: 1.5rem;';
        
        // Capture button (circular)
        const captureBtn = document.createElement('button');
        captureBtn.style.cssText = `
            width: 70px;
            height: 70px;
            border-radius: 50%;
            border: 4px solid white;
            background: transparent;
            cursor: pointer;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        const captureInner = document.createElement('div');
        captureInner.style.cssText = 'width: 62px; height: 62px; border-radius: 50%; background: white;';
        captureBtn.appendChild(captureInner);
        
        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.style.cssText = 'width: auto; padding: 0.5rem 1.5rem;';
        
        // Take photo button
        const takePhotoBtn = document.createElement('button');
        takePhotoBtn.textContent = '✓ Take Photo';
        takePhotoBtn.className = 'btn';
        takePhotoBtn.style.cssText = 'width: auto; padding: 0.5rem 1.5rem;';
        
        // Close button (top right)
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: none;
            border: none;
            color: white;
            font-size: 2rem;
            cursor: pointer;
        `;
        
        // Event handlers
        closeBtn.onclick = () => this.stopCamera();
        cancelBtn.onclick = () => this.stopCamera();
        
        takePhotoBtn.onclick = async () => {
            try {
                // Draw current video frame to canvas
                const ctx = canvas.getContext('2d');
                
                // Flip the image horizontally (mirror effect)
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(previewVideo, 0, 0, canvas.width, canvas.height);
                
                // Convert to blob
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
                const file = new File([blob], `camera_capture_${Date.now()}.jpg`, {
                    type: 'image/jpeg'
                });
                
                // Stop camera and process the photo
                this.stopCamera();
                await this.handlePhotoFile(file);
                
            } catch (error) {
                console.error('Error capturing photo:', error);
                alert('Failed to capture photo');
            }
        };
        
        // Build overlay
        closeBtn.onclick = () => this.stopCamera();
        cancelBtn.onclick = () => this.stopCamera();
        
        captureContainer.appendChild(cancelBtn);
        captureContainer.appendChild(takePhotoBtn);
        
        overlay.appendChild(closeBtn);
        overlay.appendChild(videoContainer);
        overlay.appendChild(captureContainer);
        document.body.appendChild(overlay);
    },
    
    /**
     * Handle photo file (from capture or file picker)
     */
    async handlePhotoFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            return;
        }
        
        this.currentPhoto = file;
        
        // Show loading indicator
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'block';
        }
        
        // Hide results list while analyzing
        const foodItemsList = document.getElementById('food-items-list');
        if (foodItemsList) {
            foodItemsList.innerHTML = '';
        }
        
        // Hide analysis results until we get the data
        const analysisResults = document.getElementById('analysis-results');
        if (analysisResults) {
            analysisResults.style.display = 'none';
        }
        
        try {
            // Analyze photo with backend
            const result = await this.analyzePhoto(file);
            
            if (result && result.items && result.items.length > 0) {
                this.results = result.items;
                
                // Display results
                this.displayResults(result);
            } else {
                alert('No food items were identified in the photo. Please try again with a clearer image.');
            }
        } catch (error) {
            console.error('Error analyzing photo:', error);
            alert('Failed to analyze photo. Make sure LM Studio is running on http://localhost:3142');
        } finally {
            // Hide loading indicator
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
        }
    },
    
    /**
     * Handle selected file (from file picker)
     */
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file || !file.type.startsWith('image/')) {
            return;
        }
        
        await this.handlePhotoFile(file);
        
        // Reset the file input
        event.target.value = '';
    },
    
    /**
     * Analyze photo using backend API
     */
    async analyzePhoto(file) {
        const formData = new FormData();
        formData.append('photo', file);
        
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
     * Display analysis results
     */
    displayResults(result) {
        const foodItemsList = document.getElementById('food-items-list');
        if (!foodItemsList) return;
        
        // Show analysis results section
        const analysisResults = document.getElementById('analysis-results');
        if (analysisResults) {
            analysisResults.style.display = 'block';
        }
        
        // Render each food item
        const itemsHtml = result.items.map((item, index) => `
            <div class="card" style="margin-bottom: 0.75rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong>${this.escapeHtml(item.name)}</strong>
                    <span style="color: #666;">${item.estimated_portion_g} g</span>
                </div>
            </div>
        `).join('');
        
        foodItemsList.innerHTML = itemsHtml;
    },
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Clear results and reset UI
     */
    clearResults() {
        this.currentPhoto = null;
        this.results = [];
        
        const analysisResults = document.getElementById('analysis-results');
        if (analysisResults) {
            analysisResults.style.display = 'none';
        }
        
        const foodItemsList = document.getElementById('food-items-list');
        if (foodItemsList) {
            foodItemsList.innerHTML = '';
        }
        
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        
        // Reset photo input
        const photoInput = document.getElementById('photo-input');
        if (photoInput) {
            photoInput.value = '';
        }
    },
    
    /**
     * Save meal to database
     */
    async saveMeal() {
        if (!this.results || this.results.length === 0) {
            alert('No food items to save.');
            return;
        }
        
        try {
            const formData = new FormData();
            
            // Add each food item as JSON
            formData.append('items', JSON.stringify(this.results));
            
            if (this.currentPhoto) {
                formData.append('photo', this.currentPhoto);
            }
            
            // For now, we just confirm the items were analyzed
            // The full meal saving would involve creating a Meal record in the database
            
            alert(`Meal saved! ${this.results.length} food item(s) identified and estimated.` + 
                  '\n\nFull meal saving functionality would be implemented in the next step.');
            
            // Clear results after save
            this.clearResults();
        } catch (error) {
            console.error('Error saving meal:', error);
            alert('Failed to save meal');
        }
    }
};

// ========== Manual Food Search Functionality ==========
const foodSearch = {
    /** Items added to the meal currently being built (in memory, not yet saved) */
    items: [],

    /** Debounce timer for the search input */
    searchDebounce: null,

    /**
     * Wire up the "Add food" button and the meal-in-progress save/clear buttons
     */
    init() {
        const addBtn = document.getElementById('add-food-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.openSearchModal());
        }

        const saveBtn = document.getElementById('save-search-meal-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveMeal());
        }

        const clearBtn = document.getElementById('clear-search-meal-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearMeal());
        }
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

        const list = document.createElement('div');
        list.id = 'food-search-results';
        list.style.cssText = 'padding: 0.5rem; overflow-y: auto; flex: 1;';
        list.innerHTML = '<p style="color: #888; text-align: center; padding: 1rem;">Start typing to search</p>';

        const footer = document.createElement('div');
        footer.style.cssText = 'padding: 1rem; border-top: 1px solid #eee;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.className = 'btn btn-secondary';
        closeBtn.addEventListener('click', () => modal.remove());
        footer.appendChild(closeBtn);

        content.appendChild(header);
        content.appendChild(list);
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
                <div style="font-weight: bold; color: #1a1a2e;">${this.escapeHtml(food.description)}</div>
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
    },

    /**
     * Handle picking a food from search results: ask for a portion in grams,
     * scale its per-100g macros, and add it to the meal being built
     */
    selectFood(food) {
        const input = window.prompt(`How many grams of "${food.description}"?`, '100');
        if (input === null) return;

        const grams = parseFloat(input);
        if (isNaN(grams) || grams <= 0) {
            alert('Please enter a valid number of grams.');
            return;
        }

        const scale = grams / 100;
        this.items.push({
            fdc_id: food.id,
            name: food.description,
            grams,
            calories: food.calories_kcal * scale,
            protein_g: food.protein_g * scale,
            carbs_g: food.carbs_g * scale,
            fat_g: food.fat_g * scale,
        });

        const modal = document.getElementById('food-search-modal');
        if (modal) modal.remove();

        this.renderMeal();
    },

    /**
     * Remove an item from the meal being built
     */
    removeItem(index) {
        this.items.splice(index, 1);
        this.renderMeal();
    },

    /**
     * Render the in-progress meal's item list and running macro total
     */
    renderMeal() {
        const section = document.getElementById('search-meal-section');
        const itemsEl = document.getElementById('search-meal-items');
        const totalEl = document.getElementById('search-meal-total');
        if (!section || !itemsEl || !totalEl) return;

        if (this.items.length === 0) {
            section.style.display = 'none';
            itemsEl.innerHTML = '';
            totalEl.innerHTML = '';
            return;
        }

        section.style.display = 'block';

        itemsEl.innerHTML = this.items.map((item, index) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0;">
                <div>
                    <div style="font-weight: bold;">${this.escapeHtml(item.name)}</div>
                    <div style="font-size: 0.8rem; color: #666;">
                        ${item.grams}g · ${Math.round(item.calories)} kcal · ${item.protein_g.toFixed(1)}g P · ${item.carbs_g.toFixed(1)}g C · ${item.fat_g.toFixed(1)}g F
                    </div>
                </div>
                <button data-index="${index}" class="remove-search-item-btn" style="background: none; border: none; color: #dc3545; font-size: 1.25rem; cursor: pointer; padding: 0.25rem 0.5rem;">&times;</button>
            </div>
        `).join('');

        itemsEl.querySelectorAll('.remove-search-item-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.removeItem(parseInt(btn.dataset.index, 10)));
        });

        const totals = this.items.reduce((acc, item) => ({
            calories: acc.calories + item.calories,
            protein_g: acc.protein_g + item.protein_g,
            carbs_g: acc.carbs_g + item.carbs_g,
            fat_g: acc.fat_g + item.fat_g,
        }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

        totalEl.textContent = `Total: ${Math.round(totals.calories)} kcal · ${totals.protein_g.toFixed(1)}g P · ${totals.carbs_g.toFixed(1)}g C · ${totals.fat_g.toFixed(1)}g F`;
    },

    /**
     * Save the meal being built to the backend via POST /meals
     */
    async saveMeal() {
        if (this.items.length === 0) {
            alert('Add at least one food first.');
            return;
        }

        try {
            await api.post('/meals', { items: this.items });
            alert(`Meal saved! ${this.items.length} food item(s).`);
            this.clearMeal();
        } catch (error) {
            console.error('Error saving meal:', error);
            alert('Failed to save meal');
        }
    },

    /**
     * Clear the meal being built without saving
     */
    clearMeal() {
        this.items = [];
        this.renderMeal();
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