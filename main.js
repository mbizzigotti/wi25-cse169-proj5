'use strict';

import {
    Renderer,
    simulation,
} from "./graphics.js"

const app = document.getElementById("app");

let renderer = new Renderer();

let c = null; // functions we defined in C!
let c_bytes = null;
let c_floats = null;
let want_exit = false;

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

function log(priority, message) {
    if (priority < 0 || priority > 2) return;
    const log = [console.info, console.warn, console.error];
    log[priority](c_string(message));
}

function log_value(value) {
    console.log(value);
}

function panic(message) {
    console.error(c_string(message));
    want_exit = true;
}

function sin(x) {
    return Math.sin(x);
}

function cos(x) {
    return Math.cos(x);
}

function sqrt(x) {
    return Math.sqrt(x);
}

const particles = []
const particle_size = 4; // 3 x position

function gfx_add_particle(x, y, z, c) {
    particles.push(x, y, z, c);
}

const debug_elements = [];
let debug_next = 0;

function debug_info(format, args) {
    if (debug_next >= debug_elements.length) {
        const debug = document.getElementById("debug");
        const debug_text = document.createElement("div");
        debug_text.className = "debug-text";
        debug_elements.push(debug_text);
        debug.appendChild(debug_text)
    }

    const base = args >> 2; // want an index (float = 4 bytes)
    const array = c_floats.slice(base, base + 16); // estimate count
    
    const format_string = (format, args) => {
        let argIndex = 0;
        return format.replace(/{}/g, () => {
            if (argIndex >= args.length) return "{empty}";
            return args[argIndex++];
        });
    };

    debug_elements[debug_next].textContent = format_string(c_string(format), array);
    debug_next += 1;
}

function add_slider(label, obj, name) {
    const controls = document.getElementById("controls");
    
    // Create a container for the slider
    const sliderContainer = document.createElement("div");
    sliderContainer.style.display = "flex";
    sliderContainer.style.alignItems = "center";
    sliderContainer.style.gap = "10px";
    sliderContainer.style.width = "100%";
    
    // Create label for the slider
    const label_element = document.createElement("label");
    label_element.textContent = label;
    label_element.style.minWidth = "300px";
    label_element.style.textAlign = "right";
    label_element.style.pointerEvents = "none"; // Allow touch/mouse events to fall through
    
    // Create the slider input
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = obj[name].toFixed(3);
    slider.style.width = "200px";
    
    // Create span to show the value
    const valueDisplay = document.createElement("input");
    valueDisplay.type = "text";
    valueDisplay.value = obj[name].toFixed(3);
    valueDisplay.style.width = "50px";
    valueDisplay.style.textAlign = "center";

    const set_value = (value) => {
        obj[name] = parseFloat(value);
        valueDisplay.value = value;
    };

    // Update slider when valueDisplay changes
    valueDisplay.addEventListener("change", function () {
        set_value(valueDisplay.value);
    });
    
    // Update value when slider changes
    slider.addEventListener("input", function () {
        set_value(slider.value);
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

let prev = null;
function loop(timestamp) {
    if (prev !== null) {
        const dt = (timestamp - prev)*0.001;
        const view_proj = c_matrix4(c.make_view_projection(camera.azimuth, camera.incline, camera.distance));

        renderer.render(view_proj, simulate);
        
        document.getElementById("FPS").textContent = `FPS: ${(1.0 / dt).toFixed(1)}`;
        debug_next = 0;
    }
    prev = timestamp;
    if (!want_exit) window.requestAnimationFrame(loop);
}

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
        log,
        panic,
        sin,
        cos,
        sqrt,
        gfx_add_particle,
        debug_info,
        add_slider,
        log_value,
    }
}).then((wasm) => {
    c = wasm.instance.exports; // Exported C Functions
    c_bytes  = new Uint8Array(wasm.instance.exports.memory.buffer);
    c_floats = new Float32Array(wasm.instance.exports.memory.buffer);

    document.addEventListener('keydown', (e) => {
        c.on_key(e.key.charCodeAt(), 1);

        if (e.key == 'r') {
            renderer.temp();
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
    document.addEventListener('touchend',   (e) => { Touching = false; });

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

    /*
    sphere = {
        vertex_buffer: create_vertex_buffer({
            v_position: vertices,
        //    i_color: [],
            i_offset: [],
        }),
        index_buffer: create_index_buffer(indices),
        index_count: indices.length,
    };
    */

    renderer.create();

    add_slider("t", simulation, "target_density");
  
    window.requestAnimationFrame(loop);
});
