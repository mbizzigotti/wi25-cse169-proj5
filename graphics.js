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

const particleRadius = 0.01;
const vertexSize   = 3 * 4;
const instanceSize = 4 * 8;
const MAX_PARTICLES = 200000;

const max_particles_per_cell = 16;

export const simulation = {
    influence_radius    : 0.3,
    target_density      : 1.0/0.007,
    pressure_multiplier : 1,
};

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

const test = []
for (let i = 0; i < 200; ++i) {
    const x = Math.random();
    test.push((x*2-1)*1.0, (Math.random()*2-1)*1.0, 0.01, x);
    //test.push((Math.random()*2-1)*5,(Math.random()*2-1)*5,0,0);
    test.push(0,0,0,0);
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
                output.fragPosition = offset.xyz*0.5+0.5;
                output.value = offset.w;
                return output;
            }

            fn heatmapGradient(t : f32) -> vec3f {
                return clamp((pow(t, 1.5) * 0.8 + 0.2) * vec3f(smoothstep(0.0, 0.35, t) + t * 0.5, smoothstep(0.5, 1.0, t), max(1.0 - t * 1.7, t * 7.0 - 6.0)), vec3f(0.0), vec3f(1.0));
            }

            @fragment
            fn fragment_main(fragData: VertexOutput) -> @location(0) vec4f {
                //return vec4f(heatmapGradient(fragData.value * 0.005) * 1, 1.0);
                return vec4f(0.0);
            }

            struct Simulation_Constants {
                grid_size           : vec3u,
                particle_count      : u32,
                dt                  : f32,
                influence_radius    : f32,
                target_density      : f32,
                pressure_multiplier : f32,
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

            const max_particles_per_cell = ${max_particles_per_cell};
            const PI = 3.141592653589793;

            struct Grid {
                data : array<u32>,
            }

            struct Grid_Count {
                data : array<atomic<u32>>,
            }

            const work_group_size = 64;
            @binding(1) @group(0) var<uniform>             in    : Simulation_Constants;
            @binding(0) @group(0) var<storage, read_write> data  : Particles;
            @binding(2) @group(0) var<storage, read_write> grid  : Grid;
            @binding(3) @group(0) var<storage, read_write> count : Grid_Count;
            
            fn coord_to_index(coord: vec3u) -> u32 {
                return coord.x + in.grid_size.x * (coord.y + coord.z * in.grid_size.y);
            }

            @compute @workgroup_size(work_group_size)
            fn clear_grid(@builtin(global_invocation_id) global_invocation_id : vec3u) {
                let idx = global_invocation_id.x;
                if (idx < arrayLength(&count.data)) {
                    atomicStore(&count.data[idx], 0);
                }
            }

            @compute @workgroup_size(work_group_size)
            fn find_neighbors(@builtin(global_invocation_id) global_invocation_id : vec3u) {
                let idx = global_invocation_id.x;
                if (idx >= in.particle_count) {return;}
                var particle = data.particles[idx];

                // Calculate grid cell position
                var coord = vec3u((particle.position * 0.5 + 0.5) * vec3f(in.grid_size));
                coord = min(coord, in.grid_size - vec3u(1,1,1));

                let grid_index = coord_to_index(coord);

                // Add this particle's index to the grid
                let k = atomicAdd(&count.data[grid_index], 1);

                if (k < max_particles_per_cell) {
                    grid.data[grid_index*max_particles_per_cell + k] = idx;
                }
            }

            fn smoothing_kernel(dist: f32) -> f32 {
                if dist >= in.influence_radius { return 0; }    
                let volume = PI * pow(in.influence_radius, 4) / 6;
                return (in.influence_radius - dist) * (in.influence_radius - dist) / volume;
            }

            fn viscosity_smoothing_kernel(dist: f32) -> f32 {
                if dist >= in.influence_radius { return 0; }
                let volume = PI * pow(in.influence_radius, 8.0) / 4.0;
                let value = max(0.0, in.influence_radius * in.influence_radius - dist * dist);
                return value * value * value / volume;
            }

            fn smoothing_kernel_grad(dist: f32) -> f32 {
                if dist >= in.influence_radius { return 0; }
                let f = in.influence_radius * in.influence_radius - dist * dist;
                let scale = -24 / (PI * pow(in.influence_radius, 8));
                return scale * dist * f * f;   
            }

            fn density_to_pressure(density: f32) -> f32 {
                let grad = density - in.target_density;
                return grad * in.pressure_multiplier;
            }

            fn shared_pressure(density1: f32, density2: f32) -> f32 {
                let pressure1 = density_to_pressure(density1);
                let pressure2 = density_to_pressure(density2);
                return (pressure1 + pressure2) * 0.5;
            }

            @compute @workgroup_size(work_group_size)
            fn calculate_density(@builtin(global_invocation_id) global_invocation_id : vec3u) {
                let idx = global_invocation_id.x;
                if (idx >= in.particle_count) {return;}

                var particle = data.particles[idx];

                // Calculate grid cell position
                var coord = vec3i((particle.position * 0.5 + 0.5) * vec3f(in.grid_size));
                //coord = clamp(coord, vec3i(0,0,0), vec3i(in.grid_size) - vec3i(1,1,1));

                particle.density = 0;

                for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                for (var dz = -1; dz <= 1; dz++) {
                    let d = vec3i(dx, dy, dz);
                    let c = coord + d;

                    if (c.x < 0 || c.x >= i32(in.grid_size.x)
                    ||  c.y < 0 || c.y >= i32(in.grid_size.y)
                    ||  c.z < 0 || c.z >= i32(in.grid_size.z))
                        {continue;}

                    let grid_index = coord_to_index(vec3u(c));
                    let count = min(max_particles_per_cell, i32(atomicLoad(&count.data[grid_index])));

                    for (var i = 0; i < count; i++) {
                        let other_idx = grid.data[grid_index*max_particles_per_cell + u32(i)];
                        let other = data.particles[other_idx];
                        let dist = length(other.position - particle.position);
                        particle.density += viscosity_smoothing_kernel(dist);
                    }
                }
                }
                }

                data.particles[idx] = particle;
            }

            const gravity = vec3f(0, -0.5, 0);

            @compute @workgroup_size(work_group_size)
            fn apply_forces(@builtin(global_invocation_id) global_invocation_id : vec3u) {
                let idx = global_invocation_id.x;
                var particle = data.particles[idx];
                var force = vec3f(0,0,0);

                let coord = vec3i((particle.position * 0.5 + 0.5) * vec3f(in.grid_size));
                for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                for (var dz = -1; dz <= 1; dz++) {
                    let d = vec3i(dx, dy, dz);
                    let c = coord + d;
                    if (c.x < 0 || c.x >= i32(in.grid_size.x)
                    ||  c.y < 0 || c.y >= i32(in.grid_size.y)
                    ||  c.z < 0 || c.z >= i32(in.grid_size.z))
                        {continue;}
                    let grid_index = coord_to_index(vec3u(c));
                    let count = min(max_particles_per_cell, i32(atomicLoad(&count.data[grid_index])));
                    for (var offset = 0; offset < count; offset++) {
                        let j = grid.data[grid_index*max_particles_per_cell + u32(offset)];

                //    for(var j: u32 = 0; j < in.particle_count; j++) {{{{
                        
                        if idx == j { continue; }

                        let other = data.particles[j];
                        var to_point = other.position - particle.position;
                        let distance = length(to_point);
                        if distance == 0 { to_point = vec3f(1,0,0); }
                        else { to_point /= distance; }
                        let grad = to_point * smoothing_kernel_grad(distance);
                        let pressure = shared_pressure(other.density, particle.density);
                        force += grad * pressure / other.density;

                        //let viscosity = viscosity_smoothing_kernel(distance);
                        //force += 100.0 * (other.velocity - particle.velocity) * viscosity;
                    }
                }
                }
                }

                //particle.velocity += gravity;
                particle.velocity = force / particle.density;
                //particle.velocity += in.dt * force / particle.density;
                
                //if false {
                //    let grid_index = coord_to_index(vec3u(coord));
                //    let n = atomicLoad(&count.data[grid_index]);
                //    particle.density = f32(n >= max_particles_per_cell);
                //}

                data.particles[idx] = particle;
            }

            struct Collision_Result {
                pos: vec3f,
                vel: vec3f,
            }

            const damping_factor = 0.97;

            // Function to handle collisions and keep particles within bounds
            fn resolve_collision(pos: vec3f, vel: vec3f) -> Collision_Result {
                var result = Collision_Result(pos, vel);

                if (result.pos.x < -1.0 || result.pos.x > 1.0) {
                    result.vel.x *= -damping_factor;
                    result.pos.x = clamp(result.pos.x, -1.0, 1.0);
                }
                if (result.pos.y < -1.0 || result.pos.y > 1.0) {
                    result.vel.y *= -damping_factor;
                    result.pos.y = clamp(result.pos.y, -1.0, 1.0);
                }
                if (result.pos.z < -1.0 || result.pos.z > 1.0) {
                    result.vel.z *= -damping_factor;
                    result.pos.z = clamp(result.pos.z, -1.0, 1.0);
                }

                return result;
            }
            
            @compute @workgroup_size(work_group_size)
            fn update(@builtin(global_invocation_id) global_invocation_id : vec3u) {
                let idx = global_invocation_id.x;

                var particle = data.particles[idx];

                // Update position
                particle.position += particle.velocity * in.dt;
                //particle.density  *= 0.0005;
                //particle.density  *= 100.0;

                // Resolve collisions
                let result = resolve_collision(particle.position, particle.velocity);
                particle.position = result.pos;
                particle.velocity = result.vel;

                data.particles[idx] = particle;
            }
            `,
        });

        const debug_shader_module = device.createShaderModule({
            code: `
            struct Uniforms {
                modelViewProjectionMatrix : mat4x4f,
            }
            
            @binding(0) @group(0) var<uniform> uniforms : Uniforms;

            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) uv: vec2f
            };

            @vertex
            fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
                // Full-screen quad vertices (z = 1, w = 1 for clip space)
                let positions = array<vec4<f32>, 4>(
                    vec4<f32>(-1.0, -1.0, 0.0, 1.0),
                    vec4<f32>( 1.0, -1.0, 0.0, 1.0),
                    vec4<f32>(-1.0,  1.0, 0.0, 1.0),
                    vec4<f32>( 1.0,  1.0, 0.0, 1.0)
                );

                let uvs = array<vec2<f32>, 4>(
                    vec2<f32>(0.0, 0.0),
                    vec2<f32>(1.0, 0.0),
                    vec2<f32>(0.0, 1.0),
                    vec2<f32>(1.0, 1.0)
                );

                var output: VertexOutput;
                output.position = transpose(uniforms.modelViewProjectionMatrix) * positions[vertex_index];
                output.uv = uvs[vertex_index];
                return output;
            }

            struct Simulation_Constants {
                grid_size           : vec3u,
                particle_count      : u32,
                dt                  : f32,
                influence_radius    : f32,
                target_density      : f32,
                pressure_multiplier : f32,
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

            const max_particles_per_cell = ${max_particles_per_cell};
            const PI = 3.141592653589793;

            struct Grid {
                data : array<u32>,
            }

            struct Grid_Count {
                data : array<atomic<u32>>,
            }

            const work_group_size = 64;
            @binding(1) @group(0) var<uniform>             in    : Simulation_Constants;
            @binding(2) @group(0) var<storage, read>       data  : Particles;
            @binding(3) @group(0) var<storage, read>       grid  : Grid;
            @binding(4) @group(0) var<storage, read_write> count : Grid_Count;

            fn calculate_density(pos: vec3f) -> f32 {
                // Calculate grid cell position
                var coord = vec3i((pos * 0.5 + 0.5) * vec3f(in.grid_size));
                coord = clamp(coord, vec3i(0,0,0), vec3i(in.grid_size) - vec3i(1,1,1));

                var density: f32 = 0;

                for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                for (var dz = -1; dz <= 1; dz++) {
                    let d = vec3i(dx, dy, dz);
                    let c = coord + d;

                    if (c.x < 0 || c.x >= i32(in.grid_size.x)
                    ||  c.y < 0 || c.y >= i32(in.grid_size.y)
                    ||  c.z < 0 || c.z >= i32(in.grid_size.z))
                        {continue;}

                    let grid_index = coord_to_index(vec3u(c));
                    let count = min(max_particles_per_cell, i32(atomicLoad(&count.data[grid_index])));

                    for (var i = 0; i < count; i++) {
                        let other_idx = grid.data[grid_index*max_particles_per_cell + u32(i)];
                        let other = data.particles[other_idx];
                        let dist = length(other.position - pos);
                        density += smoothing_kernel(dist);
                    }
                }
                }
                }

                return density;
            }

            fn smoothing_kernel_grad(dist: f32) -> f32 {
                let scale = 12 / (pow(in.influence_radius, 4) * PI);
                return (dist - in.influence_radius) * scale;
            }

            fn density_to_pressure(density: f32) -> f32 {
                let grad = density - in.target_density;
                return grad * in.pressure_multiplier;
            }

            fn shared_pressure(density1: f32, density2: f32) -> f32 {
                let pressure1 = density_to_pressure(density1);
                let pressure2 = density_to_pressure(density2);
                return (pressure1 + pressure2) * 0.5;
            }

            fn calculate_force(pos: vec3f, density: f32) -> vec3f {
                let coord = vec3i((pos * 0.5 + 0.5) * vec3f(in.grid_size));
                var force = vec3f(0,0,0);
                
                for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                for (var dz = -1; dz <= 1; dz++) {
                    let d = vec3i(dx, dy, dz);
                    let c = coord + d;

                    if (c.x < 0 || c.x >= i32(in.grid_size.x)
                    ||  c.y < 0 || c.y >= i32(in.grid_size.y)
                    ||  c.z < 0 || c.z >= i32(in.grid_size.z))
                        {continue;}

                    let grid_index = coord_to_index(vec3u(c));
                    let count = min(max_particles_per_cell, i32(atomicLoad(&count.data[grid_index])));

                    for (var offset = 0; offset < count; offset++) {
                        let j = grid.data[grid_index*max_particles_per_cell + u32(offset)];
                        //if  { continue; }

                        let other = data.particles[j];
                        var to_point = (other.position - pos);
                        let distance = length(to_point);
                        if distance < 0.0000001 { continue;} //to_point = vec3f(1,0,0); }
                        else { to_point /= distance; }
                        let grad = to_point * smoothing_kernel_grad(distance);
                        let pressure = shared_pressure(other.density, density);
                        //if other.density == 0 || density == 0 { continue; }
                        force -= grad * pressure / other.density;
                        //force += to_point * other.density;
                    }
                }
                }
                }

                return force;
            }
            
            fn coord_to_index(coord: vec3u) -> u32 {
                return coord.x + in.grid_size.x * (coord.y + coord.z * in.grid_size.y);
            }

            fn smoothing_kernel(dist: f32) -> f32 {
                if dist >= in.influence_radius { return 0; }
                let volume = PI * pow(in.influence_radius, 8.0) / 4.0;
                let value = max(0.0, in.influence_radius * in.influence_radius - dist * dist);
                return value * value * value / volume;
            }

            fn heatmapGradient(t : f32) -> vec3f {
                return clamp((pow(t, 1.5) * 0.8 + 0.2) * vec3f(smoothstep(0.0, 0.35, t) + t * 0.5, smoothstep(0.5, 1.0, t), max(1.0 - t * 1.7, t * 7.0 - 6.0)), vec3f(0.0), vec3f(1.0));
            }

            @fragment
            fn fs_main(frag: VertexOutput) -> @location(0) vec4f {
                let pos = vec3f(frag.uv * 2.0 - 1.0, 0.01);    

                //var density: f32 = 0;
                //for (var i = 0; i < i32(in.particle_count); i++) {
                //    let particle = data.particles[i];
                //    let dist = length(pos - particle.position);
                //    density += smoothing_kernel(dist);
                //}
                var density = calculate_density(pos);
                //let force = normalize(calculate_force(pos, density));

                //density *= 0.007;
                
                let coord = (pos * 0.5 + 0.5) * vec3f(in.grid_size);
                let grid_index = coord_to_index(vec3u(coord));
                let n = atomicAdd(&count.data[grid_index], 0);
                //let density = f32(n) / 16;
//
                //var min_dist: f32 = 1e9;
                //for (var i: u32 = 0; i < n; i++) {
                //    let idx = grid.data[grid_index*max_particles_per_cell + i];
                //    let particle = data.particles[idx];
                //    let dist = length(pos - particle.position);
                //    min_dist = min(min_dist, dist);
                //}
                
                if n > 16 { return vec4f(1, 1, 0, 1); }

                var color: vec3f;
                if (density > in.target_density) {
                    color = mix(vec3(1.0), vec3(1.0, 0.0, 0.0), (density - in.target_density) * 0.01);
                }
                else {
                    color = mix(vec3(1.0), vec3(0.0, 0.0, 1.0), (in.target_density - density) * 0.01);
                }
                return vec4f(color, 1.0);

                //return vec4f(heatmapGradient(density * 0.005), 1.0);
                //return vec4f(density, force.xy*0.3, 1.0);
                //return vec4f(vec3f(.01/min_dist), 1.0);
            }`
        })

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
        this.temp();
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

        this.debug_pipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: debug_shader_module,
                entryPoint: "vs_main",
            },
            fragment: {
                module: debug_shader_module,
                entryPoint: "fs_main",
                targets: [{ format: presentation_format }],
            },
            primitive: {
                topology: "triangle-strip",
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
        this.simulation_buffer = device.createBuffer({
            size: 32,
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

        this.debug_uniforms = device.createBindGroup({
            layout: this.debug_pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniform_buffer } },
                { binding: 1, resource: { buffer: this.simulation_buffer } },
                { binding: 2, resource: { buffer: this.instance_buffer, offset: 0, size: MAX_PARTICLES * instanceSize } },
                { binding: 3, resource: { buffer: this.grid_buffer       } },
                { binding: 4, resource: { buffer: this.grid_count_buffer } },
            ],
        });
    }

    upload_particles(particles) {
    //    const instanceArray = new Float32Array(test);
    //    device.queue.writeBuffer(this.instance_buffer, 0, instanceArray, 0, instanceArray.length);
    //    this.instance_count = instanceArray.byteLength / instanceSize;
    }

    temp() {
        const instanceArray = new Float32Array(test);
        device.queue.writeBuffer(this.instance_buffer, 0, instanceArray, 0, instanceArray.length);
        this.instance_count = instanceArray.byteLength / instanceSize;
    }

    render(view_proj, simulate) {
        const command_encoder = device.createCommandEncoder();
        
        device.queue.writeBuffer(this.uniform_buffer, 0, view_proj);
        
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
            const constants = new ArrayBuffer(32);
            const floats    = new Float32Array(constants);
            const ints      = new Uint32Array(constants);
            ints  [0] = grid_size_x;
            ints  [1] = grid_size_y;
            ints  [2] = grid_size_z;
            ints  [3] = this.instance_count;
            floats[4] = simulate ? 0.00005 : 0;
            floats[5] = simulation.influence_radius;
            floats[6] = simulation.target_density;
            floats[7] = simulation.pressure_multiplier;
            device.queue.writeBuffer(this.simulation_buffer, 0, constants);
            
            for (let i = 0; i < 1; i++) {
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

            cmd.setPipeline(this.debug_pipeline);
            cmd.setBindGroup(0, this.debug_uniforms);
            cmd.draw(4);

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