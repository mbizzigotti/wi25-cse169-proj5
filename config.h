#pragma once
#ifndef __clang__
#error "Only supporting clang compiler"
#endif

#define true  1
#define false 0
typedef int bool;

#define EXPORT __attribute__((visibility("default")))
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

void panic(char const* message);

// ********************************************************
