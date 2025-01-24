'use strict';

import {
    gl,
    compile_shaders,
    create_vertex_buffer,
    bind_vertex_buffer,
    get_uniform,
} from "./graphics.js"

//let app = document.getElementById("app");
//let gl = app.getContext("webgl2");
let wasm = null;
let c_memory_array = null;
let want_exit = false;

// Find length of C string
function c_string_length(address) {
    const start = address;
    while (c_memory_array[address] != 0) address++;
    return address - start;
}

// Convert C string to Javascript string
function c_string(address) {
    const length = c_string_length(address);
    const bytes = c_memory_array.slice(address, address + length);
    return new TextDecoder().decode(bytes);
}

function log(priority, message) {
    if (priority < 0 || priority > 2) return;
    const log = [console.info, console.warn, console.error];
    log[priority](c_string(message));
}

function panic(message) {
    console.error(c_string(message));
    want_exit = true;
}

let prev = null;
function loop(timestamp) {
    if (prev !== null) {
        wasm.instance.exports.update((timestamp - prev)*0.001);
    }
    prev = timestamp;
    if (!want_exit) window.requestAnimationFrame(loop);
}

WebAssembly.instantiateStreaming(fetch('bin/main.wasm'), {
    env: {
        log,
        panic,
    }
}).then((w) => {
    wasm = w;
    c_memory_array = new Uint8Array(wasm.instance.exports.memory.buffer);

    wasm.instance.exports.thing();

    document.addEventListener('keydown', (e) => {
        wasm.instance.exports.game_keydown(e.key.charCodeAt());
    });

    compile_shaders();

    const vertex_buffer = create_vertex_buffer({
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
  
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  
    bind_vertex_buffer("test", vertex_buffer);
  
    gl.uniform1f(get_uniform("test", "alpha"), 1.0);
  
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    //window.requestAnimationFrame(loop);
});
