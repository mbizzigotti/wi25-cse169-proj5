struct Uniforms {
    modelViewProjectionMatrix : mat4x4f,
    color_mode : i32,
}

@binding(0) @group(0) var<uniform> uniforms : Uniforms;

struct VertexOutput {
    @builtin(position) Position : vec4f,
    @location(0)       fragPosition: vec3f,
    @location(1)       value : f32,
}

@vertex
fn vertex_main (
    @builtin(instance_index) instanceIdx : u32,
    @location(0) position : vec3f,
    @location(1) offset : vec4f
) -> VertexOutput {
    var output : VertexOutput;
    output.Position = transpose(uniforms.modelViewProjectionMatrix) * vec4f(position.xyz + offset.xyz + vec3f(0,0.35,0), 1.0);
    output.fragPosition = offset.xyz*0.5+0.5;
    output.value = offset.w;
    return output;
}

fn saturate(x: vec3f) -> vec3f { return clamp(x, vec3f(0), vec3f(1)); }

// https://www.shadertoy.com/view/4dsSzr
fn neonGradient(t: f32) -> vec3f {
    let k = abs(0.43 - t) * 1.7;
    return saturate(vec3f(t * 1.3 + 0.1, k*k, (1.0 - t) * 1.7));
}
fn heatmapGradient(t : f32) -> vec3f {
    return clamp((pow(t, 1.5) * 0.8 + 0.2) * vec3f(smoothstep(0.0, 0.35, t) + t * 0.5, smoothstep(0.5, 1.0, t), max(1.0 - t * 1.7, t * 7.0 - 6.0)), vec3f(0.0), vec3f(1.0));
}
fn rainbowGradient(t: f32) -> vec3f {
    var c = 1.0 - pow(abs(vec3f(t) - vec3f(0.65, 0.5, 0.2)) * vec3f(3.0, 3.0, 5.0), vec3f(1.5, 1.3, 1.7));
    let k = abs(t - 0.04) * 5.0;
    c.r = max((0.15 - k*k), c.r);
    if t < 0.5 { c.g = smoothstep(0.04, 0.45, t); }
    return clamp(c, vec3f(0.0), vec3f(1.0));
}
fn hueGradient(t: f32) -> vec3f {
    let p = abs(fract(t + vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return clamp(p - 1.0, vec3f(0.0), vec3f(1.0));
}
fn electricGradient(t: f32) -> vec3f {
    let k = smoothstep(0.6, 0.9, t);
    let c = vec3f(t * 8.0 - 6.3, k*k, pow(t, 3.0) * 1.7);
    return clamp(pow(c*10,vec3f(0.2)), vec3f(0.0), vec3f(1.0));	
}

@fragment
fn fragment_main(fragData: VertexOutput) -> @location(0) vec4f {
    switch (uniforms.color_mode) {
    case  0: { return vec4f(    neonGradient(fragData.value * 0.015), 1.0); }
    case  1: { return vec4f( heatmapGradient(fragData.value * 0.015), 1.0); }
    case  2: { return vec4f(     hueGradient(fragData.value * 0.005), 1.0); }
    case  3: { return vec4f( rainbowGradient(fragData.value * 0.005), 1.0); }
    case  4: { return vec4f(electricGradient(fragData.value * 0.010), 1.0); }
    default: { return vec4f(1.0); }
    }
}

struct Simulation_Constants {
    grid_size           : vec3u,
    particle_count      : u32,
    dt                  : f32,
    time                : f32,
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

const max_particles_per_cell = 16;
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
            particle.density += smoothing_kernel(dist);
        }
    }
    }
    }

    data.particles[idx] = particle;
}

const gravity = vec3f(0, -10000.0, 0);

// Function to handle collisions and keep particles within bounds
fn calculate_boundary_force(pos: vec3f) -> vec3f {
    var force = vec3f(0);
    const bound = 0.4;
    let x0 = 0.3 - 1.0 + 0.2*sin(in.time*10);
    let x1 = 0.9;

    if (pos.x < x0) {
        force += vec3f(x0 - pos.x, 0.0, 0.0);
    }
    else if(pos.x > x1) {
        force += vec3f(x1 - pos.x, 0.0, 0.0);
    }
    if (pos.y < -bound) {
        force += vec3f(0.0, -bound - pos.y, 0.0);
    }
    else if (pos.y > 0.9) {
        force += vec3f(0.0, 0.9 - pos.y, 0.0);
    }
    if (pos.z < -bound) {
        force += vec3f(0.0, 0.0, -bound - pos.z);
    }
    else if (pos.z > bound) {
        force += vec3f(0.0, 0.0, bound - pos.z);
    }

    return force;
}

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

            let viscosity = viscosity_smoothing_kernel(distance);
            force += 200.0 * (other.velocity - particle.velocity) * viscosity;
        }
    }
    }
    }

    force += 2e10 * calculate_boundary_force(particle.position);

    particle.velocity += gravity * in.dt;
    particle.velocity += in.dt * force / particle.density;

    data.particles[idx] = particle;
}

@compute @workgroup_size(work_group_size)
fn update(@builtin(global_invocation_id) global_invocation_id : vec3u) {
    let idx = global_invocation_id.x;

    var particle = data.particles[idx];

    // Update position
    particle.position += particle.velocity * in.dt;

    // Density is useless at this point, this is for visualization
    particle.density = length(particle.velocity);

    data.particles[idx] = particle;
}
