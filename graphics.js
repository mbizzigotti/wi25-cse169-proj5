'use strict';

let app = document.getElementById("app");
export let gl = app.getContext("webgl2");

const shaders = {
    test: {
        attributes: {
            v_position: {
                location: null,
                count: 2,
                type: gl.FLOAT,
                normalize: false,
            },
            v_color: {
                location: null,
                count: 4,
                type: gl.FLOAT,
                normalize: false,
            },
        },
        uniforms: {
            alpha: null,
        },
        vertex: `
        attribute vec4 v_position;
        attribute vec4 v_color;

        varying lowp vec4 vColor;

        void main(void) {
            gl_Position = v_position;
            vColor = v_color;
        }
        `,
        fragment: `
        varying lowp vec4 vColor;

        uniform mediump float alpha;

        void main(void) {
            gl_FragColor = vec4(vColor.rgb, alpha);
        }
        `,
        id: 0,
    },
}

export function compile_shaders() {
    for (const [key, info] of Object.entries(shaders)) {
        console.log(`Loading shader "${key}"`)
        info.id = create_shader_program(info.vertex, info.fragment);

        for (const name in info.attributes) {
            info.attributes[name].location = gl.getAttribLocation(info.id, name);
        }

        for (const name in info.uniforms) {
            info.uniforms[name] = gl.getUniformLocation(info.id, name);
        }
    }
    console.log(shaders["test"]);
}

function create_shader_program(vertex, fragment) {
    const vert = create_shader(gl.VERTEX_SHADER, vertex);
    const frag = create_shader(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(`${gl.getProgramInfoLog(program)}`);
    }
    return program;
}

function create_shader(stage, source) {
    const shader = gl.createShader(stage);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert(
            `An error occurred compiling the shaders: ${gl.getShaderInfoLog(shader)}`
        );
    }
    return shader;
}

export function create_vertex_buffer(arrays) {
    const buffers = {};
    for (const name in arrays) {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arrays[name]), gl.STATIC_DRAW);
        buffers[name] = buffer;
    }
    return buffers;
}

export function bind_vertex_buffer(shader_name, vertex_buffer) {
    const shader = shaders[shader_name];
    for (const name in vertex_buffer) {
        const attribute = shader.attributes[name];

        gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer[name]);
        gl.vertexAttribPointer(
            attribute.location,
            attribute.count,
            attribute.type,
            attribute.normalize,
            0, 0
        );
        gl.enableVertexAttribArray(attribute.location);
    }
    gl.useProgram(shader.id);
}

export function get_uniform(shader_name, uniform_name) {
    return shaders[shader_name].uniforms[uniform_name];
}
