'use strict';

import {
    Renderer,
    simulation,
    modify_simulation_callback,
} from "./graphics.js"

const app = document.getElementById("app");
const renderer = new Renderer();

let c = null; // functions we defined in C!
let c_bytes = null;
let c_floats = null;

const HALF_PI = 1.5707963267948966;

//////////////////////////////////////////////////////////////////////////////
// Helper functions to interface with C from this terrible terrible language

// Find length of C string
function c_string_length(address) {
    const start = address;
    while (c_bytes[address] != 0) address++;
    return address - start;
}

// Convert C string to Javascript string
function c_string(address) {
    const length = c_string_length(address);
    const bytes = c_bytes.slice(address, address + length);
    return new TextDecoder().decode(bytes);
}

// Convert C matrix4 to Javascript matrix4 (both just arrays)
function c_matrix4(address) {
    const base = address >> 2; // want an index (float = 4 bytes)
    return c_floats.slice(base, base + 16);
}

//////////////////////////////////////////////////////////////////////////////



//////////////////////////////////////////////////////////////////////////////
// Functions to export to C

function sin(x) {
    return Math.sin(x);
}

function cos(x) {
    return Math.cos(x);
}

function add_slider(obj, name, min, max) {
    const controls = document.getElementById("controls");
    
    // Create a container for the slider
    const sliderContainer = document.createElement("div");
    sliderContainer.style.display = "flex";
    sliderContainer.style.alignItems = "center";
    sliderContainer.style.gap = "10px";
    sliderContainer.style.width = "100%";
    
    // Create label for the slider
    const label_element = document.createElement("label");
    label_element.textContent = name;
    label_element.style.minWidth = "300px";
    label_element.style.textAlign = "right";
    label_element.style.pointerEvents = "none"; // Allow touch/mouse events to fall through
    
    // Create the slider input
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 1000;
    slider.value = 1000 * (obj[name] - min) / (max - min);
    slider.style.width = "200px";
    slider.style.color = "red";
    slider.style.background = "blue";
    
    // Create span to show the value
    const valueDisplay = document.createElement("input");
    valueDisplay.type = "text";
    valueDisplay.value = obj[name];
    valueDisplay.style.width = "fit";
    valueDisplay.style.textAlign = "center";
    valueDisplay.style.background = "#0F0F2F"
    valueDisplay.style.fontFamily = "monospace"
    valueDisplay.style.color = "white"
    valueDisplay.style.border = "none"

    const set_value = (value) => {
        obj[name] = value;
        modify_simulation_callback();
    };

    // Update slider when valueDisplay changes
    valueDisplay.addEventListener("change", function () {
        const value = parseFloat(valueDisplay.value);
        set_value(value);
        slider.value = 1000 * (value - min) / (max - min);
    });
    
    // Update value when slider changes
    slider.addEventListener("input", function () {
        const t = parseInt(slider.value) / 1000;
        const value = min + (max - min) * t;
        set_value(value);
        valueDisplay.value = value.toFixed(3);
    });
    
    // Append elements to container
    sliderContainer.appendChild(label_element);
    sliderContainer.appendChild(valueDisplay);
    sliderContainer.appendChild(slider);
    
    // Append slider container to controls
    controls.appendChild(sliderContainer);
}

//////////////////////////////////////////////////////////////////////////////


let simulate = true;

const camera = {
    azimuth: 0.0,
    incline: 0.0,
    distance: 3.0,
};

function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
}

const touch_state = {
    x: 0,
    y: 0,
};

let LeftDown = false;
let Touching = false;

WebAssembly.instantiateStreaming(fetch('bin/main.wasm'), {
    env: {
        sin,
        cos,
    }
}).then(async (wasm) => {
    c = wasm.instance.exports; // Exported C Functions
    c_bytes  = new Uint8Array(wasm.instance.exports.memory.buffer);
    c_floats = new Float32Array(wasm.instance.exports.memory.buffer);

    document.addEventListener('keydown', (e) => {
        if (e.key == 'r') {
            renderer.create_particles();
        }
        if (e.key == ' ') {
            simulate = !simulate;
        }
    });
    //document.addEventListener('keyup', (e) => {
    //    c.on_key(e.key.charCodeAt(), 0);
    //});

    app.addEventListener('mousedown', (e) => {
        touch_state.x = e.clientX;
        touch_state.y = e.clientY;
        LeftDown = true;
    });
    document.addEventListener('mouseup', (e) => {
        LeftDown = false;
    });

    document.addEventListener('mouseleave', (e) => {
        LeftDown = false;
    });

    document.addEventListener('mousemove', (e) => {
        const maxDelta = 100;
        const dx = clamp(  e.clientX - touch_state.x,  -maxDelta, maxDelta);
        const dy = clamp(-(e.clientY - touch_state.y), -maxDelta, maxDelta);
    
        touch_state.x = e.clientX;
        touch_state.y = e.clientY;
    
        // Move camera
        if (LeftDown) {
            const rate = 0.01;
            camera.azimuth = camera.azimuth + dx * rate;
            camera.incline = clamp(camera.incline - dy * rate, -HALF_PI, HALF_PI);
        }
    });

    document.addEventListener('touchstart', (e) => {
        touch_state.x = e.touches[0].clientX;
        touch_state.y = e.touches[0].clientY;
        Touching = true;
    });
    document.addEventListener('touchend', (e) => { Touching = false; });

    document.addEventListener('touchmove', (e) => {
        const maxDelta = 100;
        const dx = clamp(  e.touches[0].clientX - touch_state.x,  -maxDelta, maxDelta);
        const dy = clamp(-(e.touches[0].clientY - touch_state.y), -maxDelta, maxDelta);
    
        touch_state.x = e.touches[0].clientX;
        touch_state.y = e.touches[0].clientY;
    
        if (Touching) {
            const rate = 0.01;
            camera.azimuth = camera.azimuth + dx * rate;
            camera.incline = clamp(camera.incline - dy * rate, -HALF_PI, HALF_PI);
        }
    });

    document.addEventListener('wheel', (e) => {
        camera.distance -= 0.01 * e.deltaY;
    });

    await renderer.create();

    add_slider(simulation, "target_density", 2000, 8000);
    add_slider(simulation, "influence_radius", 0.001, 0.5);
    add_slider(simulation, "pressure_multiplier", 100000, 1000000);
    add_slider(simulation, "particle_count", 5000, 50000);
    add_slider(simulation, "wave_speed", 0.0, 2.0);
  
    let prev = null;

    function loop(timestamp) {
        if (prev === undefined) prev = timestamp;

        const dt = (timestamp - prev)*0.001;

        const view_proj = c_matrix4(c.make_view_projection(camera.azimuth, camera.incline, camera.distance));

        renderer.render(view_proj, simulate);
            
        document.getElementById("FPS").textContent = `FPS: ${(1.0 / dt).toFixed(1)}`;

        prev = timestamp;

        window.requestAnimationFrame(loop);
    }

    window.requestAnimationFrame(loop);
});
