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
    
    // Add to active workout
    if (activeWorkout && exerciseName) {
        const newExercise = {
            id: null,
            workout_id: activeWorkout.id,
            name: exerciseName,
            order: exercisesData.length + 1,
            sets: []
        };
        
        exercisesData.push(newExercise);
        
        // Save to backend immediately
        saveExerciseToBackend(newExercise)
            .then(savedExercise => {
                // Replace temp exercise with saved one
                const tempIndex = exercisesData.findIndex(ex => !ex.id);
                if (tempIndex !== -1) {
                    exercisesData[tempIndex] = savedExercise;
                    renderExercises();
                }
            })
            .catch(err => {
                console.error('Error saving exercise:', err);
                alert('Failed to save exercise');
            });
    }
    
    hideExercisePicker();
};

// Save exercise to backend
async function saveExerciseToBackend(exercise) {
    const response = await api.patch(`/workouts/${activeWorkout.id}`, {
        exercises: [{
            name: exercise.name,
            order: exercise.order
        }]
    });
    
    return {
        id: response.exercises ? response.exercises[0].id : null,
        workout_id: activeWorkout.id,
        name: exercise.name,
        order: exercise.order,
        sets: []
    };
}

// Render exercises for active workout
function renderExercises() {
    const container = document.getElementById('workout-exercises');
    
    if (exercisesData.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center;">No exercises yet. Click "+ Add Exercise" to add one.</p>';
        return;
    }
    
    container.innerHTML = exercisesData.map((exercise, exIndex) => `
        <div class="card" data-exercise-id="${exercise.id || 'temp-' + exIndex}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong>${exercise.name}</strong>
                ${!exercise.id ? '<span style="font-size: 0.8rem; color: #888;">(unsaved)</span>' : ''}
            </div>
            
            <table class="set-table" style="width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.85rem;">
                <thead>
                    <tr style="border-bottom: 1px solid #eee;">
                        <th style="text-align: left; padding: 0.5rem; width: 15%;">Set</th>
                        <th style="text-align: left; padding: 0.5rem; width: 15%;">Previous</th>
                        <th style="text-align: left; padding: 0.5rem; width: 25%;">kg</th>
                        <th style="text-align: left; padding: 0.5rem; width: 25%;">Reps</th>
                        <th style="text-align: center; padding: 0.5rem; width: 20%;">✓</th>
                    </tr>
                </thead>
                <tbody id="sets-${exercise.id || 'temp-' + exIndex}">
                    ${renderSetRows(exercise, exIndex)}
                </tbody>
            </table>
            
            <div style="margin-top: 0.5rem;">
                <button class="btn btn-secondary" style="font-size: 0.85rem; padding: 0.5rem;" onclick="showAddSetForm(${exIndex})">
                    + Add Set
                </button>
            </div>
        </div>
    `).join('');
}

// Render set rows for a given exercise
function renderSetRows(exercise, exIndex) {
    const sets = exercise.sets || [];
    
    if (sets.length === 0) {
        return '<tr><td colspan="5" style="text-align: center; color: #999; padding: 0.5rem;">No sets added yet</td></tr>';
    }
    
    return sets.map((set, setIndex) => `
        <tr data-set-id="${set.id || 'temp-set-' + setIndex}">
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                <span style="color: #666;">Set ${setIndex + 1}</span>
            </td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                <span style="color: #999;">—</span>
            </td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                <input type="number" class="set-weight" data-set-index="${setIndex}" value="${set.weight_kg !== null ? set.weight_kg : ''}" placeholder="kg" min="0" step="0.5" style="width: 100%; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;">
            </td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                <input type="number" class="set-reps" data-set-index="${setIndex}" value="${set.reps !== null ? set.reps : ''}" placeholder="reps" min="1" style="width: 100%; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;">
            </td>
            <td style="padding: 0.5rem; border-bottom: 1px solid #eee; text-align: center;">
                <button class="btn-check-set" style="background: #4caf50; color: white; border: none; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; font-size: 1rem;" onclick="saveSet(${exIndex}, ${setIndex})">✓</button>
            </td>
        </tr>
    `).join('');
}

// Show add set form
window.showAddSetForm = function(exerciseIndex) {
    const exercise = exercisesData[exerciseIndex];
    if (!exercise) return;
    
    // Check if this exercise exists in backend (has ID)
    const setIndex = (exercise.sets ? exercise.sets.length : 0) + 1;
    
    const setHtml = `
        <div class="set-item" data-set-id="temp-new-${Date.now()}">
            <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                <span style="font-size: 0.85rem; color: #666;">Set ${setIndex}:</span>
                <input type="number" id="new-set-reps" placeholder="Reps" min="1" style="flex: 1; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;">
                <input type="number" id="new-set-weight" placeholder="kg" min="0" step="0.5" style="flex: 1; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;">
            </div>
            <div style="display: flex; gap: 1rem; align-items: center;">
                <label style="font-size: 0.85rem;">
                    <input type="checkbox" id="new-set-to-failure"> To failure
                </label>
                <input type="number" id="new-set-rest" placeholder="Rest (s)" min="0" style="flex: 1; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px;">
                <textarea id="new-set-note" placeholder="Note (optional)" style="flex: 2; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem;"></textarea>
            </div>
            <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" style="flex: 1; padding: 0.4rem;" onclick="saveNewSet(${exerciseIndex}, ${setIndex - 1})">Save Set</button>
                <button class="btn btn-danger" style="flex: 1; padding: 0.4rem;" onclick="cancelNewSet(this)">Cancel</button>
            </div>
        </div>
    `;
    
    const container = document.getElementById(`sets-${exercise.id || 'temp-' + exerciseIndex}`);
    if (!container) return;
    
    const addSetBtn = container.querySelector('button');
    if (addSetBtn) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = setHtml;
        container.insertBefore(tempDiv.firstChild, addSetBtn);
    }
};

// Save new set
window.saveNewSet = async function(exerciseIndex, tempSetOrder) {
    const exercise = exercisesData[exerciseIndex];
    if (!exercise) return;
    
    // Get values from form
    const repsInput = document.getElementById('new-set-reps');
    const weightInput = document.getElementById('new-set-weight');
    const toFailureCheckbox = document.getElementById('new-set-to-failure');
    const restInput = document.getElementById('new-set-rest');
    const noteInput = document.getElementById('new-set-note');
    
    if (!repsInput || !weightInput) return;
    
    const set = {
        order: tempSetOrder + 1,
        reps: parseInt(repsInput.value) || null,
        weight_kg: parseFloat(weightInput.value) || null,
        to_failure: toFailureCheckbox ? toFailureCheckbox.checked : false,
        rest_seconds: parseInt(restInput.value) || null,
        note: noteInput ? noteInput.value : ''
    };
    
    // Remove the temporary set form
    const tempItem = document.querySelector('[data-set-id*="temp-new-"]');
    if (tempItem) {
        tempItem.remove();
    }
    
    // For new exercise, add to local state immediately
    if (!exercise.id) {
        if (!exercise.sets) exercise.sets = [];
        exercise.sets.push(set);
        renderExercises();
        return;
    }
    
    // For existing exercise, save to backend
    try {
        // Get current workout details from backend
        const workoutDetail = await api.get(`/workouts/${activeWorkout.id}`);
        
        // Build the update payload
        const exercisesUpdate = workoutDetail.exercises.map((ex, idx) => ({
            id: ex.id,
            name: ex.name,
            order: ex.order
        }));
        
        // Add the new set to the last exercise (current one)
        if (!exercisesUpdate[exerciseIndex].sets) exercisesUpdate[exerciseIndex].sets = [];
        exercisesUpdate[exerciseIndex].sets.push(set);
        
        // Update workout with new set
        const updatedWorkout = await api.patch(`/workouts/${activeWorkout.id}`, {
            exercises: exercisesUpdate,
            notes: workoutDetail.notes
        });
        
        // Update local state with saved data
        exercisesData[exerciseIndex].sets = updatedWorkout.exercises[exerciseIndex].sets;
        renderExercises();
        
    } catch (error) {
        console.error('Error saving set:', error);
        alert('Failed to save set');
    }
};

// Save set (update individual weight/reps)
window.saveSet = async function(exerciseIndex, setIndex) {
    const exercise = exercisesData[exerciseIndex];
    if (!exercise || !exercise.id) return;
    
    // Get current values from the inputs
    const setRow = document.querySelector(`[data-exercise-id="${exercise.id || 'temp-' + exerciseIndex}"] tbody tr[data-set-id]`);
    const weightInput = setRow.querySelector('.set-weight');
    const repsInput = setRow.querySelector('.set-reps');
    
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
        
        // Update local state with saved data
        exercisesData[exerciseIndex].sets = workoutDetail.exercises[exerciseIndex].sets.map((s, sIdx) => {
            if (sIdx === setIndex) {
                return { ...s, weight_kg: weight_kg !== null ? weight_kg : s.weight_kg, reps: reps !== null ? reps : s.reps };
            }
            return s;
        });
        
    } catch (error) {
        console.error('Error saving set:', error);
        alert('Failed to save set');
    }
};

// Cancel new set
window.cancelNewSet = function(btn) {
    btn.closest('.set-item').remove();
};

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
                
                // Prepare exercises data with sets
                const exercisesPayload = workoutDetail.exercises.map(ex => ({
                    id: ex.id,
                    name: ex.name,
                    order: ex.order,
                    sets: (ex.sets || []).map((set, i) => ({
                        id: set.id,
                        order: set.order,
                        reps: set.reps,
                        weight_kg: set.weight_kg,
                        to_failure: set.to_failure,
                        rest_seconds: set.rest_seconds,
                        note: set.note
                    }))
                }));
                
                // Update workout with finish info
                const finishedAt = new Date().toISOString();
                await api.patch(`/workouts/${activeWorkout.id}`, {
                    finished_at: finishedAt,
                    notes: workoutDetail.notes
                });
                
                // Reset active workout state
                activeWorkout = null;
                exercisesData = [];
                
                // Hide active workout section, show start button
                document.getElementById('active-workout-section').style.display = 'none';
                document.getElementById('start-workout-section').style.display = 'block';
                
                // Reset timer
                timer.reset();
                
                alert(`Workout finished! Duration: ${timer.getFormattedTime()}`);
                
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
        addExerciseBtn.addEventListener('click', () => {
            showExercisePicker();
        });
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
            
            // Set timer display based on duration
            if (workout.duration_seconds !== null) {
                updateTimerDisplay(workout.duration_seconds);
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
                timer.start();
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