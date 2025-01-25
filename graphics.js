'use strict';

let app = document.getElementById("app");
export let gl = app.getContext("webgl2");

gl.viewport(0,0, app.clientWidth, app.clientHeight);

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
            view_proj: null,
            alpha: null,
        },
        vertex: `#version 300 es

        in vec2 v_position;
        in vec4 v_color;

        out vec4 vColor;

        uniform mat4 view_proj;

        void main() {
            gl_Position = view_proj * vec4(v_position, 0.0, 1.0);
            vColor = v_color;
        }
        `,
        fragment: `#version 300 es
        precision mediump float;
        
        in vec4 vColor;
        out vec4 fragment;

        void main() {
            fragment = vec4(vColor.rgb, 1.0);
        }
        `,
        id: 0,
    },
    cube: {
        attributes: {},
        uniforms: {
            view_proj: null,
            model: null,
        },
        vertex: `#version 300 es

        uniform mat4 view_proj;
        uniform mat4 model;

        out vec3 color;

        const vec3 [8] vertices = vec3 [8] (
            vec3(-0.5, -0.5,  0.5), // 0 Front Bottom-left
            vec3( 0.5, -0.5,  0.5), // 1 Front Bottom-right
            vec3( 0.5,  0.5,  0.5), // 2 Front Top-right
            vec3(-0.5,  0.5,  0.5), // 3 Front Top-left
            vec3(-0.5, -0.5, -0.5), // 4 Back  Bottom-left
            vec3( 0.5, -0.5, -0.5), // 5 Back  Bottom-right
            vec3( 0.5,  0.5, -0.5), // 6 Back  Top-right
            vec3(-0.5,  0.5, -0.5)  // 7 Back  Top-left
        );

        const int [36] indices = int [36] (
            0, 1, 2, 2, 3, 0, // Front face
            4, 6, 5, 6, 4, 7, // Back face
            4, 0, 3, 3, 7, 4, // Left face
            1, 5, 6, 6, 2, 1, // Right face
            3, 2, 6, 6, 7, 3, // Top face
            4, 5, 1, 1, 0, 4  // Bottom face
        );

        void main() {
            vec3 pos = vertices[indices[gl_VertexID]];
            gl_Position = view_proj * model * vec4(pos, 1.0);
            color = pos + 0.5;
        }
        `,
        fragment: `#version 300 es
        precision mediump float;

        in vec3 color;
        out vec4 fragment;

        void main(void) {
            fragment = vec4(color, 1.0);
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
    console.log(shaders["cube"]);
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
