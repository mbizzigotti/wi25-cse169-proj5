CC="/opt/homebrew/opt/llvm/bin/clang" # Only for MacOS

bin/main.wasm: $(wildcard *.c) $(wildcard *.h)
	$(CC) --target=wasm32 -Os -fno-builtin -Wall -Wextra -Wswitch-enum --no-standard-libraries -Wl,--export-all -Wl,--no-entry -Wl,--allow-undefined  -o bin/main.wasm main.c

clean:
	rm bin/*