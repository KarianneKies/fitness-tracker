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
let activeMeal = null; // { id, isPastEdit } while editing a past meal in the meal builder
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

            // Load saved meals for Food tab
            if (tabId === 'food' && typeof foodSearch !== 'undefined') {
                foodSearch.loadSavedMeals();
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

    /**
     * Wire up the "Add meal" entry point, the food search button, and the
     * meal-in-progress save/cancel buttons. Also loads the saved meals list.
     */
    init() {
        const addMealBtn = document.getElementById('add-meal-btn');
        if (addMealBtn) {
            addMealBtn.addEventListener('click', () => this.openMealBuilder());
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

        this.loadSavedMeals();
    },

    /**
     * Open the meal builder for a brand new meal: show the meal type/date
     * fields and the (empty) item list, and hide the "Add Meal" entry point.
     */
    openMealBuilder() {
        activeMeal = null;
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

        const typeSelect = document.getElementById('meal-type-select');
        if (typeSelect) typeSelect.value = '';

        this.renderMeal();
    },

    /**
     * Close the meal builder without saving, discarding any added/edited items.
     */
    closeMealBuilder() {
        activeMeal = null;
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
                    <span style="flex-shrink: 0; font-size: 0.65rem; padding: 0.15rem 0.4rem; border-radius: 4px; color: white; white-space: nowrap; background: ${food.source === 'custom' ? '#e94560' : '#1a1a2e'};">${food.source === 'custom' ? 'YOURS' : 'USDA'}</span>
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
    },

    /**
     * Handle picking a food from search results: ask for a portion in grams,
     * and add it to the meal being built (per-100g macros kept as-is so the
     * portion can be edited later without losing precision)
     */
    selectFood(food) {
        const input = window.prompt(`How many grams of "${food.description}"?`, '100');
        if (input === null) return;

        const grams = parseFloat(input);
        if (isNaN(grams) || grams <= 0) {
            alert('Please enter a valid number of grams.');
            return;
        }

        this.items.push({
            fdc_id: food.id,
            name: food.description,
            grams,
            per100: {
                calories: food.calories_kcal,
                protein_g: food.protein_g,
                carbs_g: food.carbs_g,
                fat_g: food.fat_g,
            },
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
     * Return to the search results view from the add-product view
     */
    showSearchView() {
        const searchView = document.getElementById('food-search-view');
        const addView = document.getElementById('food-add-product-view');
        if (addView) addView.style.display = 'none';
        if (searchView) searchView.style.display = 'flex';
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
     * Save the reviewed product via POST /foods/custom, then treat it exactly
     * like picking a normal search result: prompt for a portion and add it
     * to the meal being built.
     */
    async saveCustomProduct() {
        const nameInput = document.getElementById('product-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            alert('Please enter a product name.');
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
            const newFood = await api.post('/foods/custom', payload);
            const modal = document.getElementById('food-search-modal');
            if (modal) modal.remove();
            this.selectFood(newFood);
        } catch (error) {
            console.error('Error saving product:', error);
            alert('Failed to save product');
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
     * grams input keeps focus while typing)
     */
    updateItemGrams(index, value) {
        const grams = parseFloat(value);
        if (isNaN(grams) || grams <= 0) return;

        this.items[index].grams = grams;

        const macros = this.computeMacros(this.items[index]);
        const macrosEl = document.querySelector(`.item-macros[data-index="${index}"]`);
        if (macrosEl) {
            macrosEl.textContent = `${Math.round(macros.calories)} kcal · ${macros.protein_g.toFixed(1)}g P · ${macros.carbs_g.toFixed(1)}g C · ${macros.fat_g.toFixed(1)}g F`;
        }

        this.updateTotal();
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
            return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0;">
                <div style="flex: 1;">
                    <div style="font-weight: bold;">${this.escapeHtml(item.name)}</div>
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

        const typeSelect = document.getElementById('meal-type-select');
        const dateInput = document.getElementById('meal-date-input');

        const payload = {
            name: typeSelect ? (typeSelect.value || undefined) : undefined,
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
            this.loadSavedMeals();
        } catch (error) {
            console.error('Error saving meal:', error);
            alert('Failed to save meal');
        }
    },

    /**
     * Load saved meals from GET /meals and render them, most recent first
     */
    async loadSavedMeals() {
        const listEl = document.getElementById('saved-meals-list');
        if (!listEl) return;

        try {
            const meals = await api.get('/meals');
            this.renderSavedMeals(meals);
        } catch (error) {
            console.error('Error loading saved meals:', error);
        }
    },

    /**
     * Render the saved meals list
     */
    renderSavedMeals(meals) {
        const listEl = document.getElementById('saved-meals-list');
        if (!listEl) return;

        if (!meals || meals.length === 0) {
            listEl.className = 'empty-state';
            listEl.innerHTML = 'No meals logged yet.';
            return;
        }

        listEl.className = '';
        listEl.innerHTML = meals.map((meal) => `
            <div class="history-card" onclick="foodSearch.showHistoryDetail(${meal.id})">
                <div class="history-card-header">
                    <span class="history-card-name">${this.escapeHtml(meal.name)}</span>
                    <button class="history-menu-btn" onclick="event.stopPropagation(); foodSearch.showMealMenu(${meal.id}, event)">☰</button>
                </div>
                <div class="history-card-date">${this.formatDate(meal.meal_date)}</div>
                <div style="font-size: 0.85rem; color: #666; margin-bottom: 0.5rem;">
                    ${meal.items.map((item) => this.escapeHtml(item.name)).join(', ')}
                </div>
                <div style="font-size: 0.85rem; font-weight: bold;">
                    ${Math.round(meal.total_calories)} kcal · ${meal.total_protein_g.toFixed(1)}g P · ${meal.total_carbs_g.toFixed(1)}g C · ${meal.total_fat_g.toFixed(1)}g F
                </div>
            </div>
        `).join('');
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
                itemsHtml = meal.items.map((item, idx) => `
                    <div class="meal-history-detail-food">
                        <div class="meal-history-detail-food-name">${this.escapeHtml(item.name)}</div>
                        <div class="meal-history-detail-food-grams">${item.grams} g</div>
                        <div class="meal-history-detail-food-macros">
                            ${Math.round(item.calories)} kcal · ${item.protein_g.toFixed(1)}g P · ${item.carbs_g.toFixed(1)}g C · ${item.fat_g.toFixed(1)}g F
                        </div>
                    </div>
                `).join('');
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

            // Set meal type select
            const typeSelect = document.getElementById('meal-type-select');
            if (typeSelect) {
                const normalizedMealName = meal.name ? meal.name.toLowerCase() : '';
                if (normalizedMealName.includes('breakfast')) typeSelect.value = 'Breakfast';
                else if (normalizedMealName.includes('lunch')) typeSelect.value = 'Lunch';
                else if (normalizedMealName.includes('dinner')) typeSelect.value = 'Dinner';
                else if (normalizedMealName.includes('snack')) typeSelect.value = 'Snack';
                else typeSelect.value = '';
            }

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

            // Carry over the meal type (Breakfast/Lunch/etc.) from the original
            const typeSelect = document.getElementById('meal-type-select');
            if (typeSelect) {
                const normalizedMealName = meal.name ? meal.name.toLowerCase() : '';
                if (normalizedMealName.includes('breakfast')) typeSelect.value = 'Breakfast';
                else if (normalizedMealName.includes('lunch')) typeSelect.value = 'Lunch';
                else if (normalizedMealName.includes('dinner')) typeSelect.value = 'Dinner';
                else if (normalizedMealName.includes('snack')) typeSelect.value = 'Snack';
                else typeSelect.value = '';
            }

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
            this.loadSavedMeals();
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