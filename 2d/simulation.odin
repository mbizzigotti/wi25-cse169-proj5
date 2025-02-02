package main
import "core:fmt"
import "core:math"
import "core:math/linalg"
import "core:math/rand"

gravity : [2] f32 = { 0, 0 };
smoothing_radius    : f32 = 70;
target_density      : f32 = 0.0;
pressure_multiplier : f32 = 0.0;
fixed : bool = false;

density_at :: proc(pos: [2] f32) -> f32 {
    d : f32 = 0;
    for j in 0..<particle_count {
        dist := linalg.length(pos - position[j]);
        d += smoothing_kernel(dist);
    }
    return d;
}

update :: proc(dt: f32) {
    for i in 0..<particle_count {
        density[i] = for_each_neighbor(i, proc(i, j: int) -> f32 {
            dist := linalg.length(position[i] - position[j]);
            return smoothing_kernel(dist);
        }, 0);
    }

    for i in 0..<particle_count {
        velocity[i] += gravity * dt;

        if fixed { velocity[i]  = 1000.0 * calculate_pressure_force(i) / density[i]; }
        else     { velocity[i] += 1000.0 * calculate_pressure_force(i) / density[i] * dt; }
    }

    for i in 0..<particle_count {
        position[i] += velocity[i] * dt;
        resolve_collision(&position[i], &velocity[i]);
    }
}

update_old :: proc(dt: f32) {
    for i in 0..<particle_count {
        d : f32 = 0.0;
        for j in 0..<particle_count {
            dist := linalg.length(position[i] - position[j]);
            d += smoothing_kernel(dist);
        }
        density[i] = d;
    }

    //for i in 0..<particle_count {
    //    
    //}

    for i in 0..<particle_count {
        velocity[i] += gravity * dt;

        if fixed { velocity[i]  = 1000.0 * calculate_pressure_force(i) / density[i]; }
        else     { velocity[i] += 1000.0 * calculate_pressure_force(i) / density[i] * dt; }
        
        position[i] += velocity[i] * dt;

        resolve_collision(&position[i], &velocity[i]);
    }
}

calculate_pressure_force :: proc(i: int) -> vec2 {
    force : vec2 = 0;
    for j in 0..<particle_count {
        if i == j { continue; }
        to_point := position[j] - position[i];
        distance := linalg.length(to_point);
        if distance == 0 { to_point = random_direction(); }
        else { to_point /= distance; }
        grad := to_point * smoothing_kernel_grad(distance);
        pressure := shared_pressure(density[j], density[i]);
        if density[i] == 0 { continue; }
        force += grad * pressure / density[j];
    }
    return force;
}

random_direction :: proc() -> vec2 {
    //angle := rand.float32_range(0, math.τ);
    //return { math.cos(angle), math.sin(angle) };
    return { 1.0, 0.0 };
}

resolve_collision :: proc(pos, vel: ^vec2) {
    damping_factor :: -0.95;
    for i in 0..<particle_count {
        x0 := particle_radius;
        x1 := WIDTH - particle_radius;
        y0 := particle_radius;
        y1 := HEIGHT - particle_radius;

        if pos.y > y1 {
            pos.y = y1;
            vel.y *= damping_factor;
        }
        else if pos.y < y0 {
            pos.y = y0;
            vel.y *= damping_factor;
        }

        if pos.x > x1 {
            pos.x = x1;
            vel.x *= damping_factor;
        }
        else if pos.x < x0 {
            pos.x = x0;
            vel.x *= damping_factor;
        }
    }
}

KERNEL_1 :: false;

smoothing_kernel :: proc(dist: f32) -> f32 {
    if dist >= smoothing_radius { return 0; }
    when KERNEL_1 {
        volume := math.PI * math.pow(smoothing_radius, 8.0) / 4.0;
        value := max(0.0, smoothing_radius * smoothing_radius - dist * dist);
        return value * value * value / volume;
    }
    else {
        volume := math.PI * math.pow(smoothing_radius, 4.0) / 6.0;
        return (smoothing_radius - dist) * (smoothing_radius - dist) / volume;
    }
}

smoothing_kernel_grad :: proc(dist: f32) -> f32 {
    if dist >= smoothing_radius { return 0; }
    when KERNEL_1 {
        f := smoothing_radius * smoothing_radius - dist * dist;
        scale := -24 / (math.PI * math.pow(smoothing_radius, 8));
        return scale * dist * f * f;   
    }
    else {
        scale := 12 / (math.pow(smoothing_radius, 4) * math.PI);
        return (dist - smoothing_radius) * scale;
    }
}

density_to_pressure :: proc(density: f32) -> f32 {
    grad := density - target_density;
    return grad * pressure_multiplier;
}

shared_pressure :: proc(density1, density2: f32) -> f32 {
    pressure1 := density_to_pressure(density1);
    pressure2 := density_to_pressure(density2);
    return (pressure1 + pressure2) * 0.5;
}