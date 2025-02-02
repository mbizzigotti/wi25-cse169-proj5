#pragma once
#ifndef __clang__
#error "Only supporting clang compiler"
#endif

// Base  **************************************************

#define EXPORT __attribute__((visibility("default")))

#define true  1
#define false 0
typedef int bool;

#define for_n(N)  for (int i = 0; i < (N); ++i)
#define for_(I,N) for (int I = 0; I < (N); ++I)

// Web API  ***********************************************

enum {
    LOG_INFO  = 0,
    LOG_WARN  = 1,
    LOG_ERROR = 2,
};

void log(int priority, char const* message);

#define log_info(M)  log(LOG_INFO, M)
#define log_warn(M)  log(LOG_WARN, M)
#define log_error(M) log(LOG_ERROR, M)

void log_value(float value);

void panic(char const* message);

enum {
    KEY_DOWN = 1,
    KEY_UP   = 0,
};

// I AM LAZY! (to copy paste more approximations)
float cos(float x);
float sin(float x);
float sqrt(float x);

void gfx_add_particle(float x, float y, float z, float color);

void debug_info(char const* format, float* args);

void add_slider(char const* name, float* ptr);

// Internal API  ******************************************

typedef struct { float x, y;       } vec2;
typedef struct { float x, y, z;    } vec3;
typedef struct { float x, y, z, w; } vec4;

typedef float mat4 [16];

// Matrix index from row,col
#define I(row, col) (row * 4 + col)

void mat4_identity(float* dst);
void mat4_multiply(float* a, float* b);
void mat4_inverse(float* dst, float* m);
void mat4_euler_angle_x(float* dst, float theta);
void mat4_euler_angle_y(float* dst, float theta);
void mat4_projection(float* dst, float fov, float aspect, float near, float far);

// ********************************************************

typedef struct {
    vec3  *position;
    vec3  *velocity;
    vec3  *force;
    float *density;
    int    count;

    float  reference_density;
} Particle_System;
