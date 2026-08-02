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
    
    container.innerHTML = exercisesData.map((exercise, exIndex) => {
        // Create a unique identifier for the tbody to avoid ID conflicts when exercises are added/replaced
        const tbodyId = `sets-${exIndex}`;
        return `
        <div class="card" data-exercise-id="${exercise.id || 'temp'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}" data-internal-index="${exIndex}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong>${exercise.name}</strong>
                ${!exercise.id ? '<span style="font-size: 0.8rem; color: #888;">(unsaved)</span>' : ''}
                <div style="display: flex; gap: 0.25rem;">
                    <button onclick="replaceExercise(${exIndex})" style="background: none; border: none; cursor: pointer; padding: 0.25rem;">🔄</button>
                    <button onclick="removeExercise(${exIndex})" style="background: none; border: none; cursor: pointer; padding: 0.25rem;">🗑️</button>
                </div>
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
                <button class="btn btn-secondary add-set-btn" style="font-size: 0.85rem; padding: 0.5rem; background: #1a1a2e !important;" data-exercise-index="${exIndex}">
                    + Add Set
                </button>
            </div>
        </div>
    `}).join('');
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
    
    // Sets are always numbered sequentially 1, 2, 3... based on position
    return sets.map((set, setIndex) => {
        const weightVal = set.weight_kg !== null ? set.weight_kg : '';
        const repsVal = set.reps !== null ? set.reps : '';
        
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
    `}).join('');
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
                
                // Reset exercises data for new workout
                exercisesData = [];
                renderExercises();
                
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
            
            try {
                // Stop the timer
                timer.stop();
                
                const workoutDetail = await api.get(`/workouts/${activeWorkout.id}`);
                
                // Count unchecked sets before filtering
                let uncheckedCount = 0;
                workoutDetail.exercises.forEach(ex => {
                    (ex.sets || []).forEach(set => {
                        if (!set.completed) uncheckedCount++;
                    });
                });
                
                // Filter out unchecked sets (only completed sets are kept)
                const exercisesPayload = workoutDetail.exercises.map(ex => ({
                    id: ex.id,
                    name: ex.name,
                    order: ex.order,
                    sets: (ex.sets || []).filter(set => set.completed).map((set, i) => ({
                        id: set.id,
                        order: set.order,
                        reps: set.reps,
                        weight_kg: set.weight_kg,
                        to_failure: set.to_failure,
                        rest_seconds: set.rest_seconds,
                        note: set.note
                    }))
                }));
                
                // Update workout with finish info and filtered sets
                const finishedAt = new Date().toISOString();
                await api.patch(`/workouts/${activeWorkout.id}`, {
                    finished_at: finishedAt,
                    notes: workoutDetail.notes,
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
                
                let message = `Workout finished! Duration: ${timer.getFormattedTime()}`;
                if (uncheckedCount > 0) {
                    message += `\n\n${uncheckedCount} unchecked set${uncheckedCount === 1 ? '' : 's'} were removed.`;
                }
                
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
            
            workoutList.innerHTML = workouts.map(workout => {
                const startedAt = new Date(workout.started_at);
                const dateStr = startedAt.toLocaleDateString();
                const timeStr = startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const durationStr = workout.duration_seconds 
                    ? `${Math.floor(workout.duration_seconds / 60)} min`
                    : 'Active';
                
                return `
                    <div class="workout-item" onclick="openWorkout(${workout.id})">
                        <div class="workout-header">
                            <span class="workout-date">${dateStr} at ${timeStr}</span>
                            <span class="workout-duration">${durationStr}</span>
                        </div>
                        ${workout.notes ? `<div class="workout-notes">${workout.notes}</div>` : ''}
                    </div>
                `;
            }).join('');
            
        } catch (error) {
            console.error('Error loading workouts:', error);
            workoutList.innerHTML = '<div class="empty-state">Failed to load workouts.</div>';
        }
    };
    
    // Open workout for editing
    window.openWorkout = async (workoutId) => {
        try {
            const workout = await api.get(`/workouts/${workoutId}`);
            
            activeWorkout = {
                id: workout.id,
                started_at: workout.started_at,
                finished_at: workout.finished_at
            };
            
            exercisesData = workout.exercises;
            
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
    };
    
    // Go back to home/workout list (legacy)
    window.goBackToHome = function() {
        closeActiveWorkout();
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