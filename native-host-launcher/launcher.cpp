#include <windows.h>
#include <string>
#include <vector>

// CommandLineToArgvW と対になる Windows の引数エスケープ。
static std::wstring quote(const std::wstring& value) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t character : value) {
        if (character == L'\\') { ++slashes; continue; }
        result.append(slashes * (character == L'"' ? 2 : 1), L'\\');
        slashes = 0;
        if (character == L'"') result += L'\\';
        result += character;
    }
    result.append(slashes * 2, L'\\');
    return result + L"\"";
}

int wmain(int argc, wchar_t** argv) {
    std::vector<wchar_t> module(32768);
    const DWORD length = GetModuleFileNameW(nullptr, module.data(), static_cast<DWORD>(module.size()));
    if (length == 0 || length >= module.size()) return 1;
    const std::wstring executable(module.data(), length);
    const std::wstring directory = executable.substr(0, executable.find_last_of(L"\\/"));
    const std::wstring electron = directory + L"\\dot.exe";
    std::wstring command = quote(electron) + L" " + quote(directory + L"\\resources\\native-host\\dist\\bridge.js");
    for (int index = 1; index < argc; ++index) command += L" " + quote(argv[index]);

    // ホストの標準入出力へ診断文を書かない。Chromium のフレームだけを中継する。
    for (const auto key : {L"NODE_OPTIONS", L"NODE_PATH", L"DOT_CONFIG_DIR", L"DOT_NATIVE_HOST_NAME", L"ELECTRON_CLI_ARGS", L"REMOTE_DEBUGGING_PORT", L"V8_INSPECTOR_PORT", L"V8_INSPECTOR_BRK_PORT"}) SetEnvironmentVariableW(key, nullptr);
    if (!SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1")) return 1;
    HANDLE streams[3] = {};
    const DWORD identifiers[] = {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
    for (int index = 0; index < 3; ++index) {
        if (!DuplicateHandle(GetCurrentProcess(), GetStdHandle(identifiers[index]), GetCurrentProcess(), &streams[index], 0, TRUE, DUPLICATE_SAME_ACCESS)) {
            for (HANDLE stream : streams) if (stream) CloseHandle(stream);
            return 1;
        }
    }
    SIZE_T attributeBytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeBytes);
    std::vector<unsigned char> attributes(attributeBytes);
    STARTUPINFOEXW startup = {};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = streams[0];
    startup.StartupInfo.hStdOutput = streams[1];
    startup.StartupInfo.hStdError = streams[2];
    startup.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
    if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &attributeBytes)) return 1;
    const BOOL configured = UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, streams, sizeof(streams), nullptr, nullptr);
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    const BOOL jobReady = job && SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    PROCESS_INFORMATION process = {};
    const BOOL created = configured && jobReady && CreateProcessW(electron.c_str(), command.data(), nullptr, nullptr, TRUE,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, directory.c_str(), &startup.StartupInfo, &process);
    DeleteProcThreadAttributeList(startup.lpAttributeList);
    for (HANDLE stream : streams) CloseHandle(stream);
    if (!created) { if (job) CloseHandle(job); return 1; }
    if (!AssignProcessToJobObject(job, process.hProcess) || ResumeThread(process.hThread) == static_cast<DWORD>(-1)) {
        TerminateProcess(process.hProcess, 1);
        CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job);
        return 1;
    }
    CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exitCode = 1;
    GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    return static_cast<int>(exitCode);
}
