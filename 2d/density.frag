#version 330 core

#define COUNT 400

uniform float smoothing_radius;
uniform float target_density;
uniform vec2 positions [COUNT];

const vec2 resolution = vec2(800, 600);

out vec4 fragment;

float smoothing_kernel(float radius, float dist) {
    float volume = 3.14159265359 * pow(radius, 8.0) / 4.0;
    float value = max(0.0, radius * radius - dist * dist);
    return value * value * value / volume;
}

float smoothing_kernel_grad(float radius, float dist) {
    if (dist >= radius) { return 0.0; }
    float f = radius * radius - dist * dist;
    float scale = -24.0 / (3.14159265359 * pow(radius, 8.0));
    return scale * dist * f * f;   
}

void main() {
    vec2 uv = 0.5 * vec2(gl_FragCoord.xy) / resolution;
    uv.y = 1.0 - uv.y;
    //fragment = vec4(uv, 0.0, 1.0);
    vec2 pos = uv * resolution;

#if 0 // View particles
    float m = 1e9;
    for (int i = 0; i < COUNT; ++i) {
        float dist = distance(positions[i].xy, pos);
        m = min(dist, m);
    }
    fragment = vec4(step(m, 20), 0.0, 0.0, 1.0);
#endif

    float d = 0.0;
    for (int i = 0; i < COUNT; ++i) {
        float dist = length(positions[i].xy - pos);
        d += smoothing_kernel(smoothing_radius, dist);
        //d += smoothing_kernel_grad(smoothing_radius, dist);
    }

    vec3 color = vec3(1.0);
    
    if (d > target_density) {
        color = mix(vec3(1.0), vec3(1.0, 0.0, 0.0), (d - target_density) / 0.001);
    }
    else {
        color = mix(vec3(1.0), vec3(0.0, 0.0, 1.0), (target_density - d) / 0.001);
    }

    //fragment = vec4(vec3(d), 1.0);
    fragment = vec4(color, 1.0);
}
