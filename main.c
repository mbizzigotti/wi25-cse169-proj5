#include "config.h"
#include "math.c"
#include "util.c"

typedef struct {
    void* base;
    int   allocated;
    int   capacity;
} Arena;

#define DIM 8
#define BOUNDARY_DAMPING_FACTOR -0.50f

float target_density      = 50.0f;
float pressure_multiplier =  0.0f;
float influence_radius    =  0.2f;
float gravity             =  0.0f;

bool enable_sim = true;

char buffer[4*1024*1024] = {0};

Particle_System particle_system;
Arena arena = (Arena) {
    .base = buffer,
    .allocated = 0,
    .capacity = sizeof(buffer),
};

#define allocateT(arena, type, count) \
    allocate(arena, count * sizeof(type))

void* allocate(Arena* arena, int size) {
    void* out = arena->base + arena->allocated;
    arena->allocated += size;
    return out;
}

void create_particle_system() {
    Particle_System* const s = &particle_system;
    s->count = DIM * DIM * DIM;
    s->position = allocateT(&arena, vec3, s->count);
    s->velocity = allocateT(&arena, vec3, s->count);
    s->force    = allocateT(&arena, vec3, s->count);
    s->density  = allocateT(&arena, float, s->count);
    //s->mass     = allocateT(&arena, float, s->count);
    //s->pressure = allocateT(&arena, float, s->count);
    //s->R        = allocateT(&arena, float, s->count);
}

void reset_particle_system() {
    Particle_System* const s = &particle_system;
    s->reference_density = 1.0f;

    int m = 0;
    for_(i,DIM) for_(j,DIM) for_(k,DIM) {
    #if 0
        const float x = ((float)i/(float)(DIM-1) - 0.5f) * 2.0f;
        const float y = ((float)k/(float)(DIM-1) - 0.5f) * 2.0f + 0.5f;
        const float z = ((float)j/(float)(DIM-1) - 0.5f) * 2.0f;
    #else
        const float x = randf() * 2.0f - 1.0f;
        //const float y = randf();
        //const float z = randf();
        const float y = ((float)k/(float)(DIM-1) - 0.5f) * 2.0f + 0.5f;
        const float z = ((float)j/(float)(DIM-1) - 0.5f) * 2.0f;
    #endif
        s->position[m] = (vec3) { x, y, z };
        s->velocity[m] = (vec3) {};
        s->force[m] = (vec3) {};
        ++m;
    }
}

const float mass = 1.0f;

float smoothing_kernel(float radius, float dist) {
    const float q = dist / radius;
    if (q >= 2.0f) return 0.0f;

    const float t0 = 1.0f - q * 0.5f;
    const float t1 = 2.0f * q + 1.0f;

    return t0 * t0 * t0 * t0 * t1;
}

float smoothing_kernel_grad(float radius, float dist) {
    const float q = dist / radius;
    if (q >= 2.0f) return 0.0f;

    const float t0 = 1.0f - q * 0.5f;
    const float t1 = 2.0f * q + 1.0f;
    const float t2 = t0 * t0 * t0;

    return 2.0f * t2 * (t0 - t1);
}

float kernel_volume(float radius) {
    const float constant = 0.557042300822f; // 7 / 4pi
    return constant / radius * radius;
}

float calculate_density(vec3 const point) {
    Particle_System* const s = &particle_system;

    float density = 0.0f;
    for_(i,s->count) {
        float distance = vec3_len(vec3_sub(point, s->position[i]));
        float influence = smoothing_kernel(influence_radius, distance);
        density += mass * influence;
    }
    return density / kernel_volume(influence_radius);
}

float density_to_pressure(float density) {
    float grad = density - target_density;
    return grad * pressure_multiplier;
}

#if 0
float calculate_property(vec3 const point) {
    Particle_System* const s = &particle_system;

    float property = 0.0f;
    for_(i,s->count) {
        float distance = vec3_len(vec3_sub(point, s->position[i]));
        float influence = calculate_weight(INFLUENCE_RADIUS, distance);
        property += s->property[i] * influence * mass / s->density[i];
    }
    return property / kernel_volume(INFLUENCE_RADIUS);
}

vec3 calculate_property_grad(vec3 const point) {
    Particle_System* const s = &particle_system;

    vec3 property_grad = {0};
    for_(i,s->count) {
        const vec3  to_point = vec3_sub(point, s->position[i]);
        const float distance = vec3_len(to_point);
        const float grad = smoothing_kernel_grad(INFLUENCE_RADIUS, distance);
        property_grad = vec3_add(property_grad, s->property[i] * grad * mass / s->density[i]);
    }
    return property_grad;
}
#endif

float shared_pressure(float density1, float density2) {
    const float pressure1 = density_to_pressure(density1);
    const float pressure2 = density_to_pressure(density2);
    return (pressure1 + pressure2) * 0.5f;
}

vec3 calculate_pressure_force(int i) {
    Particle_System* const s = &particle_system;

    vec3 pressure_grad = {0};
    for_(j,s->count) {
        if (i == j) continue;
        vec3 to_point = vec3_sub(s->position[j], s->position[i]);
        const float distance = vec3_len(to_point);
        if (distance == 0.0f) to_point = (vec3) {1.0f, 0.0f, 0.0f};
        const vec3 grad = vec3_mul1(to_point, smoothing_kernel_grad(influence_radius, distance) / distance);
        const float pressure = shared_pressure(s->density[j], s->density[i]);
        if (s->density[i] != 0.0f)
        pressure_grad = vec3_add(pressure_grad, vec3_mul1(grad, pressure * mass / s->density[j]));
    }
    return pressure_grad;
}

void simulation_step(float dt) {
    Particle_System* const s = &particle_system;

    // ! Calculate densities !
    for_n(s->count) {
        s->density[i] = calculate_density(s->position[i]);
    }

    for_n(s->count) {
        const vec3 pressure_a = vec3_mul1(calculate_pressure_force(i), dt / s->density[i]);
        //s->velocity[i] = vec3_add(s->velocity[i], (vec3) {0.0f, gravity, 0.0f});
        //s->velocity[i] = vec3_add(s->velocity[i], pressure_a);
        s->velocity[i] = pressure_a;
    }

    for_n (s->count) {
        vec3 position = vec3_add(s->position[i], vec3_mul1(s->velocity[i], dt));
        vec3 velocity = s->velocity[i];

        if (position.y < -2.0f) {
            position.y = -2.0f;
            velocity.y = velocity.y * BOUNDARY_DAMPING_FACTOR;
        }
        else
        if (position.y > 2.0f) {
            position.y = 2.0f;
            velocity.y = velocity.y * BOUNDARY_DAMPING_FACTOR;
        }

        if (position.x < -2.0f) {
            position.x = -2.0f;
            velocity.x = velocity.x * BOUNDARY_DAMPING_FACTOR;
        }
        else
        if (position.x > 2.0f) {
            position.x = 2.0f;
            velocity.x = velocity.x * BOUNDARY_DAMPING_FACTOR;
        }

        if (position.z < -2.0f) {
            position.z = -2.0f;
            velocity.z = velocity.z * BOUNDARY_DAMPING_FACTOR;
        }
        else
        if (position.z > 2.0f) {
            position.z = 2.0f;
            velocity.z = velocity.z * BOUNDARY_DAMPING_FACTOR;
        }

        s->position[i] = position;
        s->velocity[i] = velocity;
    }
}

EXPORT void create() {
    create_particle_system();
    reset_particle_system();
    log_info("Created particle system");

    add_slider("Influence Radius",    &influence_radius);
    add_slider("Target Density",      &target_density);
    add_slider("Pressure Multiplier", &pressure_multiplier);
    add_slider("Gravity",             &gravity);
}

EXPORT void update(float dt) {
    if (enable_sim)
        //for_n(4)
            simulation_step(dt * 0.01f);
    float min = 1e9f,
          max = -1e9f;
    for_n (particle_system.count) {
        float const d = particle_system.density[i];
        if (d < min) min = d;
        if (d > max) max = d;
    }
    for_n (particle_system.count) {
        vec3 const p = particle_system.position[i];
        float const d = particle_system.density[i];
        float const m = (d - min) / (max - min);
        gfx_add_particle(p.x, p.y, p.z, m);
    }
    debug_info("min {}", &min);
    debug_info("max {}", &max);
    debug_info("{}", &target_density);
    debug_info("{}", &pressure_multiplier);
    //target_density = (min + max) * 0.5f;
}

EXPORT void on_key(int key, int action) {
    if (action != KEY_DOWN) return;

    if (key == 'r') {
        reset_particle_system();
    }

    if (key == ' ') {
        enable_sim = !enable_sim;
    }

    if (key == 's') {
        simulation_step(1.0f/60.0f);
    }
}

EXPORT float* make_view_projection(float azimuth, float incline, float distance) {
    mat4 world, temp;

    mat4_euler_angle_y(temp, -azimuth);
    mat4_euler_angle_x(world, -incline);
    mat4_multiply(temp, world);
    mat4_identity(world);
    world[I(2,3)] = distance;
    mat4_multiply(temp, world);
    mat4_inverse(world, temp);

    static mat4 projection;

    mat4_projection(projection, 0.8f, 1.0f, 0.01f, 100.0f);
    mat4_multiply(projection, world);

    return projection;
}
