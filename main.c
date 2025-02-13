#include "config.h"
#include "math.c"

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

    mat4_projection(projection, 0.8f, 8.0f/6.0f, 0.01f, 100.0f);
    mat4_multiply(projection, world);

    return projection;
}
