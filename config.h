#pragma once
#ifndef __clang__
#error "Only supporting clang compiler"
#endif

// Base  **************************************************

#define EXPORT __attribute__((visibility("default")))

#define for_n(N)  for (int i = 0; i < (N); ++i)
#define for_(I,N) for (int I = 0; I < (N); ++I)

// Web API  ***********************************************

// I AM LAZY! (to copy paste more approximations)
float cos(float x);
float sin(float x);
//float sqrt(float x);

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
