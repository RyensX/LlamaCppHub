use std::process::Command;

#[cfg(all(windows, not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn hidden_command(program: &str) -> Command {
    #[cfg(all(windows, not(debug_assertions)))]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    #[cfg(not(all(windows, not(debug_assertions))))]
    {
        Command::new(program)
    }
}
