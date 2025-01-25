#include "config.h"

// original: https://andrewkay.name/blog/post/efficiently-approximating-tan-x/
// author: Andrew Kay
// approximation of tan with lower relative error
static inline float tan(float x) {
    const float pisqby4 = 2.4674011002723397f;
    const float adjpisqby4 = 2.471688400562703f;
    const float adj1minus8bypisq = 0.189759681063053f;
    const float xsq = x * x;
    return x * (adjpisqby4 - adj1minus8bypisq * xsq) / (pisqby4 - xsq);
}

extern float cos(float x);
extern float sin(float x);
extern float sqrt(float x);
//static inline float cos(float x) {
//    const float tausq = 39.4784176044;
//    const float x4sq = 4.0f * x * x;
//    return 1.0f - (5.0f * x4sq) / (x4sq + tausq);
//}
//
//static inline float sin(float x) {
//    const float cosx = cos(x);
//    return 1.0f - cosx * cosx;
//}

EXPORT void thing() {
    log_error("what is this??");
}

EXPORT void update(float dt) {
    log_info("test test");
}

typedef struct {
    float x, y, z, w;
} vec4;

typedef float mat4[16];

#define I(row, col) (row * 4 + col)
#define set_row(M, row, x, y, z, w) \
    ((vec4*)(M))[row] = (vec4) {x, y, z, w}

void mat4_zero(float* dst) {
    for (int i = 0; i < 16; ++i)
        dst[i] = 0.0f;
}

void mat4_identity(float* dst) {
    for (int i = 0; i < 16; ++i)
        dst[i] = 0.0f;

    dst[I(0,0)] = 1.0f;
    dst[I(1,1)] = 1.0f;
    dst[I(2,2)] = 1.0f;
    dst[I(3,3)] = 1.0f;
}

// dst <- inv(m)
bool mat3_inverse(float* dst, float* m) {
    float det = m[I(0,0)] * (m[I(1,1)] * m[I(2,2)] - m[I(2,1)] * m[I(1,2)]) -
                m[I(0,1)] * (m[I(1,0)] * m[I(2,2)] - m[I(1,2)] * m[I(2,0)]) +
                m[I(0,2)] * (m[I(1,0)] * m[I(2,1)] - m[I(1,1)] * m[I(2,0)]);

    if (det == 0) return true;

    float invdet = 1.0f / det;

    dst[I(0,0)] = (m[I(1,1)] * m[I(2,2)] - m[I(2,1)] * m[I(1,2)]) * invdet;
    dst[I(0,1)] = (m[I(0,2)] * m[I(2,1)] - m[I(0,1)] * m[I(2,2)]) * invdet;
    dst[I(0,2)] = (m[I(0,1)] * m[I(1,2)] - m[I(0,2)] * m[I(1,1)]) * invdet;
    dst[I(1,0)] = (m[I(1,2)] * m[I(2,0)] - m[I(1,0)] * m[I(2,2)]) * invdet;
    dst[I(1,1)] = (m[I(0,0)] * m[I(2,2)] - m[I(0,2)] * m[I(2,0)]) * invdet;
    dst[I(1,2)] = (m[I(1,0)] * m[I(0,2)] - m[I(0,0)] * m[I(1,2)]) * invdet;
    dst[I(2,0)] = (m[I(1,0)] * m[I(2,1)] - m[I(2,0)] * m[I(1,1)]) * invdet;
    dst[I(2,1)] = (m[I(2,0)] * m[I(0,1)] - m[I(0,0)] * m[I(2,1)]) * invdet;
    dst[I(2,2)] = (m[I(0,0)] * m[I(1,1)] - m[I(1,0)] * m[I(0,1)]) * invdet;

    return false;
}

void mat4_transpose(float* dst) {
	for_(i,4) {
		for(int j = i + 1; j < 4; ++j) {
            float temp = dst[I(i,j)];
			dst[I(i,j)] = dst[I(j,i)];
            dst[I(j,i)] = temp;
		}
	}
}

float mat4_minor(float* m, int c, int r) {
	mat4 p;

	for_(i,3) {
		const int col = (i < c)? i : i+1;
		for_(j,3) {
			const int row = (j < r)? j : j+1;
			p[I(i,j)] = m[I(col,row)];
		}
	}
    
	const float x0 = +p[I(0,0)] * (p[I(1,1)] * p[I(2,2)] - p[I(1,2)] * p[I(2,1)]);
	const float x1 = -p[I(0,1)] * (p[I(1,0)] * p[I(2,2)] - p[I(1,2)] * p[I(2,0)]);
	const float x2 = +p[I(0,2)] * (p[I(1,0)] * p[I(2,1)] - p[I(1,1)] * p[I(2,0)]);
	return x0 + x1 + x2;
}

float mat4_cofactor(float* m, int i, int j) {
	const float sign = ((i + j) % 2 == 0)? 1.0f : -1.0f;
	return sign * mat4_minor(m, i, j);
}

void mat4_adjoint(float* dst, float* m) {
	for_(i,4) {
		for_(j,4) {
			dst[I(i,j)] = mat4_cofactor(m, i, j);
		}
	}
}

void mat4_inverse_transpose(float* dst, float* m) {
    mat4 adjoint;
    mat4_adjoint(adjoint, m);

	float determinant = 0.0f;
	for_n(4) {
		determinant += m[I(i,0)] * adjoint[I(i,0)];
	}
	const float inv_det = 1.0 / determinant;
	for_(i,4) {
		for_(j,4) {
			dst[I(i,j)] = adjoint[I(i,j)] * inv_det;
		}
	}
}

void mat4_inverse(float* dst, float* m) {
    mat4_inverse_transpose(dst, m);
    mat4_transpose(dst);
}

// a <- a * b
void mat4_multiply(float* a, float* b) {
    float temp[16];
    for (int i = 0; i < 4; ++i)
    for (int j = 0; j < 4; ++j) {
        float value = 0.0f;
        for (int k = 0; k < 4; ++k)
            value += a[I(i,k)] * b[I(k,j)];
        temp[I(i,j)] = value;
    }
    for (int i = 0; i < 16; ++i)
        a[i] = temp[i];
}

void mat4_euler_angle_x(float* dst, float theta) {
    const float sint = sin(theta);
    const float cost = cos(theta);
    set_row(dst, 0, 1.0f, 0.0f, 0.0f, 0.0f);
    set_row(dst, 1, 0.0f, cost,-sint, 0.0f);
    set_row(dst, 2, 0.0f, sint, cost, 0.0f);
    set_row(dst, 3, 0.0f, 0.0f, 0.0f, 1.0f);
}

void mat4_euler_angle_y(float* dst, float theta) {
    const float sint = sin(theta);
    const float cost = cos(theta);
    set_row(dst, 0, cost, 0.0f, sint, 0.0f);
    set_row(dst, 1, 0.0f, 1.0f, 0.0f, 0.0f);
    set_row(dst, 2,-sint, 0.0f, cost, 0.0f);
    set_row(dst, 3, 0.0f, 0.0f, 0.0f, 1.0f);
}

void mat4_projection(float* dst, float fov, float aspect, float near, float far) {
    mat4_zero(dst);
    const float tanhalffov = tan(0.5f * fov);
	dst[I(0,0)] = 1.0f / (aspect*tanhalffov);
	dst[I(1,1)] = 1.0f / (tanhalffov);
	dst[I(2,2)] = -(far + near) / (far - near);
	dst[I(3,2)] = -1.0f;
	dst[I(2,3)] = -2.0f*far*near / (far - near);
}

EXPORT float* make_view_projection(float azimuth, float incline) {
/*  
    world = glm.identity(glm.mat4)
    world[3][2] = distance
    world = math.matrix4_from_euler_angle_y(glm.radians(azimuth)) \
          * math.matrix4_from_euler_angle_x(glm.radians(incline)) \
          * world;
    view := world
    project := math.matrix4_perspective(glm.radians(fov), aspect, near, far);
    return view, project;

*/
    const float distance = 10.0f;

    static float world[16];
    static float temp[16];

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

#undef I
