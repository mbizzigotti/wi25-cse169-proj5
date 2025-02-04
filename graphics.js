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

const particleRadius = 0.02;
const vertexSize   = 3 * 4;
const instanceSize = 4 * 8;
const MAX_PARTICLES = 100000;

const test = []
for (let i = 0; i < 10000; ++i) {
    const x = Math.random();
    test.push((x*2-1)*1.0, (Math.random()*2-1)*1.0, (Math.random()*2-1)*1.0, x);
    test.push((Math.random()*2-1)*0.1,(Math.random()*2-1)*0.1,(Math.random()*2-1)*0.1,0);
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

        this.compute_pipeline   = null;
        this.simulation_buffer  = null;
        this.compute_bind_group = null;
    }

    async create() {
        const shader_module = device.createShaderModule({
            code: `
            struct Uniforms {
                modelViewProjectionMatrix : mat4x4f,
            }
            
            @binding(0) @group(0) var<uniform> uniforms : Uniforms;
            
            struct VertexOutput {
                @builtin(position) Position : vec4f,
                @location(0) fragPosition: vec3f,
                @location(1) value : f32,
            }
            
            @vertex
            fn vertex_main (
                @builtin(instance_index) instanceIdx : u32,
                @location(0) position : vec3f,
                @location(1) offset : vec4f
            ) -> VertexOutput {
                var output : VertexOutput;
                output.Position = transpose(uniforms.modelViewProjectionMatrix) * vec4f(position.xyz + offset.xyz, 1.0);
                output.fragPosition = position;
                output.value = offset.w;
                return output;
            }

            fn heatmapGradient(t : f32) -> vec3f {
                return clamp((pow(t, 1.5) * 0.8 + 0.2) * vec3f(smoothstep(0.0, 0.35, t) + t * 0.5, smoothstep(0.5, 1.0, t), max(1.0 - t * 1.7, t * 7.0 - 6.0)), vec3f(0.0), vec3f(1.0));
            }

            @fragment
            fn fragment_main(fragData: VertexOutput) -> @location(0) vec4f {
                return vec4f(heatmapGradient(fragData.value), 1.0);
            }

            struct Simulation_Constants {
                dt : f32,
            }

            struct Particle {
                position : vec3f,
                density  : f32,
                velocity : vec3f,
                color    : f32,
            }

            struct Particles {
                particles : array<Particle>,
            }

            @binding(0) @group(0) var<storage, read_write> data : Particles;
            @binding(1) @group(0) var<uniform>             in   : Simulation_Constants;
            
            struct Collision_Result {
                pos: vec3f,
                vel: vec3f,
            }

            // Function to handle collisions and keep particles within bounds
            fn resolve_collision(pos: vec3f, vel: vec3f) -> Collision_Result {
                var result = Collision_Result(pos, vel);

                if (result.pos.x < -1.0 || result.pos.x > 1.0) {
                    result.vel.x = -result.vel.x;
                    result.pos.x = clamp(result.pos.x, -1.0, 1.0);
                }
                if (result.pos.y < -1.0 || result.pos.y > 1.0) {
                    result.vel.y = -result.vel.y;
                    result.pos.y = clamp(result.pos.y, -1.0, 1.0);
                }
                if (result.pos.z < -1.0 || result.pos.z > 1.0) {
                    result.vel.z = -result.vel.z;
                    result.pos.z = clamp(result.pos.z, -1.0, 1.0);
                }

                return result;
            }
            
            @compute @workgroup_size(64)
            fn simulate(@builtin(global_invocation_id) global_invocation_id : vec3u) {
                let idx = global_invocation_id.x;

                var particle = data.particles[idx];

                // Update position
                particle.position += particle.velocity * in.dt;

                // Resolve collisions
                let result = resolve_collision(particle.position, particle.velocity);
                particle.position = result.pos;
                particle.velocity = result.vel;

                data.particles[idx] = particle;
            }
            `,
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
        // --------------------------------------------------------------------------------------------
        // TODO: What is this???
        const instanceArray = new Float32Array(test);
        device.queue.writeBuffer(this.instance_buffer, 0, instanceArray, 0, instanceArray.length);
        this.instance_count = instanceArray.byteLength / instanceSize;
        // --------------------------------------------------------------------------------------------

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
            size: 4 * 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.uniform_bind_group = device.createBindGroup({
            layout: this.render_pipeline.getBindGroupLayout(0),
            entries: [
            {
                binding: 0,
                resource: {
                    buffer: this.uniform_buffer,
                },
            },
            ],
        });

        // =====================================> COMPUTE <=====================================
        this.compute_pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: shader_module,
                entryPoint: 'simulate',
            },
        });

        this.simulation_buffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(
            this.simulation_buffer,
            0,
            new Float32Array([
                0.05
            ])
        );

        this.compute_bind_group = device.createBindGroup({
            layout: this.compute_pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.instance_buffer,
                        offset: 0,
                        size: MAX_PARTICLES * instanceSize,
                    },
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.simulation_buffer,
                    },
                },
            ],
        });
        // =====================================================================================
    }

    upload_particles(particles) {
    //    const instanceArray = new Float32Array(test);
    //    device.queue.writeBuffer(this.instance_buffer, 0, instanceArray, 0, instanceArray.length);
    //    this.instance_count = instanceArray.byteLength / instanceSize;
    }

    render(view_proj) {
        const command_encoder = device.createCommandEncoder();
        
        device.queue.writeBuffer(
            this.uniform_buffer,
            0,
            view_proj.buffer,
            view_proj.byteOffset,
            view_proj.byteLength
        );
        
        const renderPassDescriptor = {
            colorAttachments: [
                {
                    view: this.view,
                    resolveTarget: context.getCurrentTexture().createView(),
                    clearValue: [0.5, 0.5, 0.5, 1.0],
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
            const cmd = command_encoder.beginComputePass();
            cmd.setPipeline(this.compute_pipeline);
            cmd.setBindGroup(0, this.compute_bind_group);
            cmd.dispatchWorkgroups(Math.ceil(this.instance_count / 64));
            cmd.end();
        }
        {
            const cmd = command_encoder.beginRenderPass(renderPassDescriptor);
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