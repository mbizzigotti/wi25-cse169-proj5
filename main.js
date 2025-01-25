'use strict';

import {
    gl,
    compile_shaders,
    create_vertex_buffer,
    bind_vertex_buffer,
    get_uniform,
} from "./graphics.js"

let wasm = null;
let c = null; // functions we defined in C!
let c_bytes = null;
let c_floats = null;
let want_exit = false;


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

//////////////////////////////////////////////////////////////////////////////


let vertex_buffer = null;

let prev = null;
function loop(timestamp) {
    if (prev !== null) {
        //wasm.instance.exports.update((timestamp - prev)*0.001);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
        bind_vertex_buffer("test", vertex_buffer);
    
        const view_proj = c_matrix4(c.make_view_projection(camera.azimuth, camera.incline));
        const model = new Float32Array([
            4.0, 0.0, 0.0, 0.0,
            0.0, 4.0, 0.0, 0.0,
            0.0, 0.0, 4.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
        ]);
        //console.log(camera, view_proj);
        //gl.uniformMatrix4fv(get_uniform("test", "view_proj"), true, view_proj);
        //gl.uniform1f(get_uniform("test", "alpha"), 1.0);
        //gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        bind_vertex_buffer("cube", {});
        gl.uniformMatrix4fv(get_uniform("cube", "view_proj"), true, view_proj);
        gl.uniformMatrix4fv(get_uniform("cube", "model"), true, model);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
    }
    prev = timestamp;
    if (!want_exit) window.requestAnimationFrame(loop);
}

function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
}

const camera = {
    azimuth: 0.0,
    incline: 0.0,
};

const touch_state = {
    x: 0,
    y: 0,
};

let LeftDown = false;

WebAssembly.instantiateStreaming(fetch('bin/main.wasm'), {
    env: {
        log,
        panic,
        sin,
        cos,
    }
}).then((w) => {
    wasm = w;
    c = wasm.instance.exports;
    c_bytes  = new Uint8Array(wasm.instance.exports.memory.buffer);
    c_floats = new Float32Array(wasm.instance.exports.memory.buffer);

    c.thing();

    document.addEventListener('keydown', (e) => {
        wasm.instance.exports.game_keydown(e.key.charCodeAt());
    });

    document.addEventListener('mousedown', (e) => {
        LeftDown = true;
    });
    document.addEventListener('mouseup', (e) => {
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
            camera.incline = clamp(camera.incline - dy * rate, -90.0, 90.0);
            //console.log(camera);
        }
    });

    compile_shaders();

    vertex_buffer = create_vertex_buffer({
        v_position: [
             1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
            -1.0, -1.0
        ],
        v_color: [
            1.0, 1.0, 1.0, 1.0, // white
            1.0, 0.0, 0.0, 1.0, // red
            0.0, 1.0, 0.0, 1.0, // green
            0.0, 0.0, 1.0, 1.0, // blue
        ],
    });

    gl.clearColor(0.0, 0.0, 0.0, 1.0); // Clear to black, fully opaque
    gl.clearDepth(1.0); // Clear everything
    gl.enable(gl.DEPTH_TEST); // Enable depth testing
    gl.depthFunc(gl.LEQUAL); // Near things obscure far things
  
    window.requestAnimationFrame(loop);
});
