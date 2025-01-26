#include "config.h"
#include "math.c"
#include "util.c"

typedef struct {
    void* base;
    int   allocated;
    int   capacity;
} Arena;

#define DIM 10

const float H = 0.5f; // smoothing radius ???
const float K = 0.1f; // pressure constant
const float MASS = 8.0f / (DIM * DIM * DIM);

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
        const float x = ((float)i/(float)(DIM-1) - 0.5f) * 2.0f;
        const float y = ((float)k/(float)(DIM-1) - 0.5f) * 2.0f;
        const float z = ((float)j/(float)(DIM-1) - 0.5f) * 2.0f;
        s->position[m] = (vec3) { x, y + 1.0f, z };
        s->velocity[m] = (vec3) {};
        s->force[m] = (vec3) {};
        ++m;
    }
}

// [Monaghan, 2000]
float weight(vec3 r) {
    const float d = vec3_len(r);
    const float q = d / H;
    if (q < 0.0f || q > 2.0f) return 0.0f;
    const float c = 4.12334035784 * H * H * H;
    const float q4 = 1.0f - q * 0.5f;
    return c * q4 * q4 * q4 * q4 * (2.0f * q + 1.0f);
}

// return true if we should skip
bool weight_grad(vec3* out, vec3 r) {
    const float rl = vec3_len(r);
    const float q = rl / H;
    if (q < 0.0f || q > 2.0f) return true;

    const float c = 4.12334035784 * H * H * H;
    const float t1 = 1.0f - q * 0.5f;
    const float t3 = t1 * t1 * t1;
    *out = vec3_mul1(r, -5.0f * c * t3 * q / rl);
    return false;
}

void simulation_step(float dt) {
    Particle_System* const s = &particle_system;

    // ! Calculate densities !
    for_(a,s->count) {
        float density = 0.0f;
        for_(b,s->count) {
            if (a == b) continue;
            const vec3 ra = particle_system.position[a];
            const vec3 rb = particle_system.position[b];
            const vec3 r  = vec3_sub(ra, rb);
            density += MASS * weight(r);
        }
        s->density[a] = density;
    }

    // ! Calculate Forces !
    for_(a,s->count) {
        vec3 force = {0};

        for_(b,s->count) {
            if (a == b) continue;
            const vec3 ra = particle_system.position[a];
            const vec3 rb = particle_system.position[b];
            const vec3 r  = vec3_sub(ra, rb);

            if (vec3_dot(r, r) < (0.001f*0.001f)) continue;

            vec3 W;
            if (weight_grad(&W, r)) continue;

            const float pa = s->density[a];
            const float pb = s->density[b];
            
            // Estimate pressure
            const float Pa = K * (pa - s->reference_density);
            const float Pb = K * (pb - s->reference_density);

            vec3 pressure = vec3_mul1(W, MASS * (Pa / (pa * pa) + Pb / (pb * pb)));
            force = vec3_sub(force, pressure);

            const float mu = 0.1f;
            const float eps = 0.001f;
            const float rsq = vec3_dot(r, r);
            const vec3 va = s->velocity[a];
            const vec3 vb = s->velocity[b];
            const float den = pb * (rsq + eps * eps);
            const vec3 v = vec3_mul1(vec3_sub(vb, va), mu / den);
            
            vec3 viscosity = vec3_mul(W, v);
            force = vec3_add(force, viscosity);
        }
        
        const vec3 gravity = {0.0f, -5.0f, 0.0f};
        s->force[a] = vec3_add(force, gravity);
    }

    // Leap-Frog
    const float halfdt = dt * 0.5f;
    for_n (s->count) {
        const vec3 a = vec3_mul1(s->force[i], 1.0f / MASS);
        const vec3 halfv = vec3_add(s->velocity[i], vec3_mul1(a, halfdt));
        
        vec3 position = vec3_add(s->position[i], vec3_mul1(halfv, dt));
        vec3 velocity = vec3_add(halfv, vec3_mul1(a, halfdt));

        // [Parshikov et al, 2000]
        //const float halfp = s->density[i] + s->R[i] * halfdt;
        //const float epsilon = (s->R[i] / halfp) * dt;
        //s->density[i] = s->density[i] * (2.0f + epsilon) / (2.0f - epsilon);

        #if 1
        if (position.y < -1.0f) {
            position.y = -1.0f;
            velocity.y = 0.0f;
        }

        #if 0
        if (position.x < -2.0f) {
            position.x = -2.0f;
            velocity.x = 0.0f;
        }
        else
        if (position.x > 2.0f) {
            position.x = 2.0f;
            velocity.x = 0.0f;
        }

        if (position.z < -2.0f) {
            position.z = -2.0f;
            velocity.z = 0.0f;
        }
        else
        if (position.z > 2.0f) {
            position.z = 2.0f;
            velocity.z = 0.0f;
        }
        #endif
        #endif

        s->velocity[i] = velocity;
        s->position[i] = position;
    }
}

EXPORT void create() {
    create_particle_system();
    reset_particle_system();
    log_info("Created particle system");
}

EXPORT void update(float dt) {
    simulation_step(0.0001f);
    float min = particle_system.density[0],
          max = particle_system.density[0];
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
    //for (int i = 0; i < particle_system.count; ++i) {
    //    debug_info("den {}", &particle_system.density[i]);
    //}
}

EXPORT void on_key(int key, int action) {
    if (action != KEY_DOWN) return;

    if (key == 'r') {
        reset_particle_system();
    }

    //if (key == ' ') {
    //    simulation_step(0.001f);
    //}
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
