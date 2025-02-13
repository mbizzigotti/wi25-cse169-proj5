'use strict';

const app = document.getElementById("app");
const context = app.getContext("webgpu");

if (!navigator.gpu) {
    alert("WebGPU not supported.");
}

const adapter = await navigator.gpu.requestAdapter();

if (!adapter) {
    alert("Couldn't request WebGPU adapter.");
}

const device = await adapter.requestDevice();
const presentation_format = navigator.gpu.getPreferredCanvasFormat();
const sampleCount = 4;

context.configure({
    device: device,
    format: presentation_format,
    alphaMode: "premultiplied",
});

function save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } finally {}
}

function load(key, obj) {
    const data = localStorage.getItem(key);
    if (data) Object.assign(obj, JSON.parse(data));
    else save(key, obj);
}

const particleRadius         = 0.007;
const vertexSize             = 3 * 4;
const instanceSize           = 4 * 8;
const MAX_PARTICLES          = 200000;
const max_particles_per_cell = 16;

export const simulation = {
    influence_radius    : 0.042,
    target_density      : 2400,
    pressure_multiplier : 300000,
    particle_count      : 8000,
    wave_speed          : 0.7,
};
let simulation_time = 0.0;

export function modify_simulation_callback() {
    save("sim", simulation);
}

load("sim", simulation);

let grid_size_x;
let grid_size_y;
let grid_size_z;
let grid_size;
const MAX_GRID_SIZE = 100;

function create_grid() {
    grid_size_x = Math.floor(2.0 / simulation.influence_radius);
    grid_size_y = Math.floor(2.0 / simulation.influence_radius);
    grid_size_z = Math.floor(2.0 / simulation.influence_radius);
    grid_size = grid_size_x * grid_size_y * grid_size_z;
}

export class Renderer {
    constructor() {
        this.render_pipeline    = null;
        this.vertex_buffer      = null;
        this.index_buffer       = null;
        this.instance_buffer    = null;
        this.uniform_bind_group = null;
        this.uniform_buffer     = null;
        this.depth_texture      = null;
        this.texture            = null;
        this.view               = null;
        this.index_count        = 0;
        this.instance_count     = 0;

        this.debug_pipeline = null;
        this.debug_uniforms = null;

        this.compute = {
            clear_grid        : null,
            find_neighbors    : null,
            calculate_density : null,
            apply_forces      : null,
            update            : null,
        };
        
        this.simulation_buffer  = null;
        this.grid_buffer        = null;
        this.grid_count_buffer  = null;
        this.compute_bind_group = null;
    }

    async create() {
        const shader_module = device.createShaderModule({
            code: await (await fetch("shader.wgsl")).text(),
        });

        const [vertices, indices] = generate_sphere(particleRadius, 12, 12);
        const sphereVertexArray = new Float32Array(vertices);
        const sphereIndexArray = new Uint16Array(indices);

        this.vertex_buffer = device.createBuffer({
            size: sphereVertexArray.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.vertex_buffer, 0, sphereVertexArray, 0, sphereVertexArray.length);
        
        this.index_buffer = device.createBuffer({
            size: sphereIndexArray.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.index_buffer, 0, sphereIndexArray, 0, sphereIndexArray.length);
        
        this.index_count = sphereIndexArray.length;
        
        this.instance_buffer = device.createBuffer({
            size: MAX_PARTICLES * instanceSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.render_pipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: shader_module,
                entryPoint: "vertex_main",
                buffers: [
                    {
                        arrayStride: vertexSize,
                        stepMode: 'vertex',
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' },
                        ]
                    },
                    {
                        arrayStride: instanceSize,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 1, offset: 0, format: 'float32x4' },
                        ]
                    },
                ],
            },
            fragment: {
                module: shader_module,
                entryPoint: "fragment_main",
                targets: [{ format: presentation_format }],
            },
            primitive: {
                topology: "triangle-list",
                cullMode: 'back',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
            multisample: {
                count: sampleCount,
            },
        });

        this.texture = device.createTexture({
            size: [app.width, app.height],
            sampleCount,
            format: presentation_format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.view = this.texture.createView();
        
        this.depth_texture = device.createTexture({
            size: [app.width, app.height],
            sampleCount,
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.uniform_buffer = device.createBuffer({
            size: 4 * (16 + 4),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.uniform_bind_group = device.createBindGroup({
            layout: this.render_pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniform_buffer } },
            ],
        });

        // =====================================> COMPUTE <=====================================
        this.simulation_buffer = device.createBuffer({
            size: 48,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.grid_buffer = device.createBuffer({
            size: MAX_GRID_SIZE*MAX_GRID_SIZE*MAX_GRID_SIZE * max_particles_per_cell * 4,
            usage: GPUBufferUsage.STORAGE,
        });
        this.grid_count_buffer = device.createBuffer({
            size: MAX_GRID_SIZE*MAX_GRID_SIZE*MAX_GRID_SIZE * 4,
            usage: GPUBufferUsage.STORAGE,
        });

        for (const name in this.compute) {
            const pipeline = device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: shader_module,
                    entryPoint: name,
                },
            });

            const bind_group = {
                layout: pipeline.getBindGroupLayout(0),
                entries: [],
            }

            switch (name) {
                case "clear_grid":
                    bind_group.entries.push(
                        { binding: 3, resource: { buffer: this.grid_count_buffer } }
                    );
                break;

                case "find_neighbors":
                    bind_group.entries.push(
                        { binding: 0, resource: { buffer: this.instance_buffer, offset: 0, size: MAX_PARTICLES * instanceSize } },
                        { binding: 1, resource: { buffer: this.simulation_buffer } },
                        { binding: 2, resource: { buffer: this.grid_buffer       } },
                        { binding: 3, resource: { buffer: this.grid_count_buffer } }
                    );
                break;

                case "calculate_density":
                    bind_group.entries.push(
                        { binding: 0, resource: { buffer: this.instance_buffer, offset: 0, size: MAX_PARTICLES * instanceSize } },
                        { binding: 1, resource: { buffer: this.simulation_buffer } },
                        { binding: 2, resource: { buffer: this.grid_buffer       } },
                        { binding: 3, resource: { buffer: this.grid_count_buffer } }
                    );
                break;

                case "apply_forces":
                    bind_group.entries.push(
                        { binding: 0, resource: { buffer: this.instance_buffer, offset: 0, size: MAX_PARTICLES * instanceSize } },
                        { binding: 1, resource: { buffer: this.simulation_buffer } },
                        { binding: 2, resource: { buffer: this.grid_buffer       } },
                        { binding: 3, resource: { buffer: this.grid_count_buffer } }
                    );
                break;

                case "update":
                    bind_group.entries.push(
                        { binding: 0, resource: { buffer: this.instance_buffer, offset: 0, size: MAX_PARTICLES * instanceSize } },
                        { binding: 1, resource: { buffer: this.simulation_buffer } }
                    );
                break;
            }

            this.compute[name] = {
                pipeline: pipeline,
                bind_group: device.createBindGroup(bind_group),
            }
        }

        // =====================================================================================
    }

    create_particles() {
        const test = [];
        (() => {
            let count = 0;
            for (let y = -0.4;; y += 0.019) {
            for (let x = -0.2; x < 0.3; x += 0.03) {
                for (let z = -0.2; z < 0.2; z += 0.019) {
                    test.push(x, y, z, 0); // pos + density
                    test.push(0,0,0,0); // velocity
                    if (++count >= simulation.particle_count) return;
                }}
            }
        })();
        const instanceArray = new Float32Array(test);
        //console.log(this.instance_buffer);
        device.queue.writeBuffer(this.instance_buffer, 0, instanceArray, 0, instanceArray.length);
        this.instance_count = instanceArray.byteLength / instanceSize;
        simulation.particle_count = this.instance_count;
    }

    render(view_proj, simulate) {
        if (simulation.particle_count != this.instance_count) {
            this.create_particles();
        }

        const command_encoder = device.createCommandEncoder();
        
        device.queue.writeBuffer(this.uniform_buffer, 0, view_proj);
        device.queue.writeBuffer(this.uniform_buffer, 64, new Int32Array([3]));
        
        const renderPassDescriptor = {
            colorAttachments: [
                {
                    view: this.view,
                    resolveTarget: context.getCurrentTexture().createView(),
                    clearValue: [0,0,0, 1.0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
            depthStencilAttachment: {
                view: this.depth_texture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        };
        
        {
            create_grid();
            const constants = new ArrayBuffer(48);
            const floats    = new Float32Array(constants);
            const ints      = new Uint32Array(constants);
            const dt = simulate ? 0.00005 : 0;
            ints  [0] = grid_size_x;
            ints  [1] = grid_size_y;
            ints  [2] = grid_size_z;
            ints  [3] = this.instance_count;
            floats[4] = dt;
            floats[5] = simulation_time;
            floats[6] = simulation.influence_radius;
            floats[7] = simulation.target_density;
            floats[8] = simulation.pressure_multiplier;
            device.queue.writeBuffer(this.simulation_buffer, 0, constants);
            simulation_time += simulation.wave_speed * 100.0 * dt;
            
            for (let i = 0; i < 4; i++) {
                const cmd = command_encoder.beginComputePass();
                
                cmd.setPipeline(this.compute.clear_grid.pipeline);
                cmd.setBindGroup(0, this.compute.clear_grid.bind_group);
                cmd.dispatchWorkgroups(Math.ceil(grid_size / 64));

                cmd.setPipeline(this.compute.find_neighbors.pipeline);
                cmd.setBindGroup(0, this.compute.find_neighbors.bind_group);
                cmd.dispatchWorkgroups(Math.ceil(this.instance_count / 64));

                cmd.setPipeline(this.compute.calculate_density.pipeline);
                cmd.setBindGroup(0, this.compute.calculate_density.bind_group);
                cmd.dispatchWorkgroups(Math.ceil(this.instance_count / 64));

                cmd.setPipeline(this.compute.apply_forces.pipeline);
                cmd.setBindGroup(0, this.compute.apply_forces.bind_group);
                cmd.dispatchWorkgroups(Math.ceil(this.instance_count / 64));

                cmd.setPipeline(this.compute.update.pipeline);
                cmd.setBindGroup(0, this.compute.update.bind_group);
                cmd.dispatchWorkgroups(Math.ceil(this.instance_count / 64));

                cmd.end();
            }
        }
        {
            const cmd = command_encoder.beginRenderPass(renderPassDescriptor);

            //cmd.setPipeline(this.debug_pipeline);
            //cmd.setBindGroup(0, this.debug_uniforms);
            //cmd.draw(4);

            cmd.setPipeline(this.render_pipeline);
            cmd.setBindGroup(0, this.uniform_bind_group);
            cmd.setVertexBuffer(0, this.vertex_buffer);
            cmd.setVertexBuffer(1, this.instance_buffer);
            cmd.setIndexBuffer(this.index_buffer, "uint16");
            cmd.drawIndexed(this.index_count, this.instance_count, 0, 0);
            cmd.end();
        }
        
        device.queue.submit([command_encoder.finish()]);
    }
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