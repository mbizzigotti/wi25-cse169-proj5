'use strict';

import {
    gl,
    compile_shaders,
    create_vertex_buffer,
    bind_vertex_buffer,
    bind_index_buffer,
    get_uniform,
    create_index_buffer,
    upload_buffer,
} from "./graphics.js"

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

function add_slider(label, value_address) {
    const controls = document.getElementById("controls");
    
    // Create a container for the slider
    const sliderContainer = document.createElement("div");
    sliderContainer.style.display = "flex";
    sliderContainer.style.alignItems = "center";
    sliderContainer.style.gap = "10px";
    sliderContainer.style.width = "100%";
    
    // Create label for the slider
    const label_element = document.createElement("label");
    label_element.textContent = c_string(label);
    label_element.style.minWidth = "300px";
    label_element.style.textAlign = "right";
    label_element.style.pointerEvents = "none"; // Allow touch/mouse events to fall through
    
    // Create the slider input
    const slider = document.createElement("input");
    const index = value_address >> 2; // want an index (float = 4 bytes)
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = c_floats[index].toFixed(3);
    slider.style.width = "200px";
    
    // Create span to show the value
    const valueDisplay = document.createElement("input");
    valueDisplay.type = "text";
    valueDisplay.value = c_floats[index].toFixed(3);
    valueDisplay.style.width = "50px";
    valueDisplay.style.textAlign = "center";

    const set_value = (value) => {
        c_floats[index] = parseFloat(value);
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
    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(valueDisplay);
    
    // Append slider container to controls
    controls.appendChild(sliderContainer);
}

//////////////////////////////////////////////////////////////////////////////


let vertex_buffer = null;
let sphere = null;

const camera = {
    azimuth: 0.0,
    incline: 0.0,
    distance: 10.0,
};

let prev = null;
function loop(timestamp) {
    if (prev !== null) {
        const dt = (timestamp - prev)*0.001;

        c.update(dt);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        
        const view_proj = c_matrix4(c.make_view_projection(camera.azimuth, camera.incline, camera.distance));
        const model = new Float32Array([
            4.0, 0.0, 0.0, 0.0,
            0.0, 4.0, 0.0, 0.0,
            0.0, 0.0, 4.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
        ]);

        const particle_count = particles.length / particle_size;
        upload_buffer(sphere.vertex_buffer.i_offset, particles);
        
        gl.disable(gl.DEPTH_TEST);
        bind_vertex_buffer("cube", {});
        gl.uniformMatrix4fv(get_uniform("cube", "view_proj"), true, view_proj);
        gl.uniformMatrix4fv(get_uniform("cube", "model"), true, model);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
        
        gl.enable(gl.DEPTH_TEST);
        bind_index_buffer("test", sphere.index_buffer);
        bind_vertex_buffer("test", sphere.vertex_buffer);
        gl.uniformMatrix4fv(get_uniform("test", "view_proj"), true, view_proj);
        gl.drawElementsInstanced(gl.TRIANGLES, sphere.index_count, gl.UNSIGNED_INT, 0, particle_count);
        
        document.getElementById("FPS").textContent = `FPS: ${(1.0 / dt).toFixed(1)}`;

//        c_floats[c.pressure_multiplier.valueOf() >> 2] = document.getElementById("test").valueAsNumber;

        debug_next = 0;
        particles.length = 0;
    }
    prev = timestamp;
    if (!want_exit) window.requestAnimationFrame(loop);
}

function generate_sphere(radius, latitudeBands, longitudeBands) {
    const vertices = [];
    const indices = [];

    // Generate vertex positions
    for (let lat = 0; lat <= latitudeBands; lat++) {
        const theta = (lat * Math.PI) / latitudeBands; // Latitude angle (0 to PI)
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        for (let lon = 0; lon <= longitudeBands; lon++) {
            const phi = (lon * 2 * Math.PI) / longitudeBands; // Longitude angle (0 to 2PI)
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            // Compute vertex position
            const x = radius * sinTheta * cosPhi;
            const y = radius * cosTheta;
            const z = radius * sinTheta * sinPhi;

            // Add the vertex
            vertices.push(x, y, z);
        }
    }

    // Generate indices
    for (let lat = 0; lat < latitudeBands; lat++) {
        for (let lon = 0; lon < longitudeBands; lon++) {
            const first = lat * (longitudeBands + 1) + lon;
            const second = first + longitudeBands + 1;

            // Create two triangles for each grid square
            indices.push(first, first + 1, second);
            indices.push(second, first + 1, second + 1);
        }
    }

    return [vertices, indices];
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
    });
    //document.addEventListener('keyup', (e) => {
    //    c.on_key(e.key.charCodeAt(), 0);
    //});
    
    const app = document.getElementById("app");

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

    compile_shaders();
    
    const [vertices, indices] = generate_sphere(0.05, 24, 24);

    sphere = {
        vertex_buffer: create_vertex_buffer({
            v_position: vertices,
        //    i_color: [],
            i_offset: [],
        }),
        index_buffer: create_index_buffer(indices),
        index_count: indices.length,
    };

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthFunc(gl.LEQUAL); // Near things obscure far things

    c.create();
  
    window.requestAnimationFrame(loop);
});
