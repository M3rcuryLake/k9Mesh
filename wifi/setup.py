#!/usr/bin/env python3
import os
import socket
import sys
import time
import argparse
import subprocess
from pathlib import Path
from typing import List, Tuple
import platform

try:
    from colorama import init, Fore, Style
except ImportError as e:
    print(f"Error: Missing dependency {e.name}. Please install requirements.txt")
    print("pip install -r requirements.txt")
    sys.exit(1)

init()

FIRMWARE_RELEASE_URL = "https://github.com/francescopace/micropython-esp32-csi/releases/download/v1.0.0-rc7"
FIRMWARE_NAME_PREFIX = "ESP32_CSI_"

# SHA256 hashes for firmware verification (update when releasing new firmware)
FIRMWARE_HASHES = {
    'ESP32_CSI.bin': '632e9898f283dfe473bc75d14e40c9b6802f7997cbab600be3502fe6dc5a5651',
    'ESP32_CSI_C3.bin': '5613e2fdfb1541b1b2ad20e5ac424f8ffaa363f7b44d2121cf33ff9548d16c98',
    'ESP32_CSI_C5.bin': '66a9a9a16fb67baa248167f6928e63b12b3010780476c23ea1e78d30b3851f0d',
    'ESP32_CSI_C6.bin': '1f29e11c82cce53da1a47d5b930bedc4446b477d5819fc7916c70d1295438b77',
    'ESP32_CSI_S3.bin': 'e4a07da0b079425b642fe80311b56731a9ea8a0165e67d1df090a051e43553ee'
}

def run_command(command):
    """Run a command and return stdout, or None on failure."""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            shell=isinstance(command, str)
        )

        if result.returncode != 0:
            return None

        return result.stdout.strip()

    except (FileNotFoundError, OSError):
        return None


def get_local_ip():
    """Get the local IPv4 address."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


def get_windows_wifi():
    """Get currently connected Wi-Fi information on Windows."""

    output = run_command([
        "netsh",
        "wlan",
        "show",
        "interfaces"
    ])

    if not output:
        return None

    ssid = None

    for line in output.splitlines():
        line = line.strip()

        if line.startswith("SSID") and not line.startswith("BSSID"):
            ssid = line.split(":", 1)[1].strip()

    if not ssid:
        return None

    # Get saved profile and password.
    profile = run_command(
        f'netsh wlan show profile name="{ssid}" key=clear'
    )

    password = None

    if profile:
        for line in profile.splitlines():
            line = line.strip()

            if line.startswith("Key Content"):
                password = line.split(":", 1)[1].strip()
                break

    return {
        "ssid": ssid,
        "password": password,
        "local_ip": get_local_ip()
    }


def get_linux_wifi():
    """Get currently connected Wi-Fi information on Linux."""

    device_output = run_command([
        "nmcli",
        "-t",
        "-f",
        "DEVICE,TYPE,STATE",
        "device"
    ])

    if not device_output:
        return None

    wifi_device = None

    for line in device_output.splitlines():
        parts = line.split(":")

        if len(parts) >= 3:
            device = parts[0]
            device_type = parts[1]
            state = parts[2]

            if device_type == "wifi" and state == "connected":
                wifi_device = device
                break

    if not wifi_device:
        return None

    wifi_info = run_command([
        "nmcli",
        "-t",
        "-f",
        "GENERAL.DEVICE,GENERAL.CONNECTION",
        "device",
        "show",
        wifi_device
    ])

    connection = None

    if wifi_info:
        for line in wifi_info.splitlines():
            if line.startswith("GENERAL.CONNECTION:"):
                connection = line.split(":", 1)[1]
                break

    if not connection:
        return None

    # SSID
    ssid = run_command([
        "nmcli",
        "-g",
        "802-11-wireless.ssid",
        "connection",
        "show",
        connection
    ])

    password = run_command([
        "nmcli",
        "-s",
        "-g",
        "802-11-wireless-security.psk",
        "connection",
        "show",
        connection
    ])

    local_ip = get_local_ip()

    return {
        "ssid": ssid,
        "password": password,
        "local_ip": local_ip
    }

def get_wifi_info():
    """Automatically detect operating system."""

    system = platform.system()

    if system == "Windows":
        return get_windows_wifi()

    elif system == "Linux":
        return get_linux_wifi()

    else:
        raise RuntimeError(
            f"Unsupported operating system: {system}"
        )



def detect_serial_ports():
    """Auto-detect available serial ports for ESP32 devices"""
    try:
        import serial.tools.list_ports
    except ImportError:
        print(f"{Fore.RED}❌ pyserial not found. Install it with:{Style.RESET_ALL}")
        print("   pip install pyserial")
        sys.exit(1)

    ports = []
    for port in serial.tools.list_ports.comports():
        desc_lower = port.description.lower()
        if any(keyword in desc_lower for keyword in ['usb', 'serial', 'uart', 'cp210', 'ch340', 'ftdi']):
            ports.append(port.device)

    return ports


def get_serial_port(port_arg):
    """Get serial port from argument or auto-detect"""
    if port_arg:
        return port_arg

    print(f"{Fore.YELLOW}🔍 Auto-detecting serial ports...{Style.RESET_ALL}")
    ports = detect_serial_ports()

    if len(ports) == 0:
        print(f"{Fore.RED}❌ No serial ports found{Style.RESET_ALL}")
        print(f"\n{Fore.YELLOW}Please connect your ESP32 device and try again.{Style.RESET_ALL}")
        sys.exit(1)
    elif len(ports) == 1:
        print(f"{Fore.GREEN}✅ Auto-detected port: {ports[0]}{Style.RESET_ALL}\n")
        return ports[0]
    else:
        print(f"{Fore.YELLOW}Multiple serial ports found:{Style.RESET_ALL}")
        for i, port in enumerate(ports, 1):
            print(f"  {i}. {port}")
        print()
        try:
            choice = int(input(f"{Fore.CYAN}Select port (1-{len(ports)}): {Style.RESET_ALL}"))
            if 1 <= choice <= len(ports):
                selected = ports[choice - 1]
                print(f"{Fore.GREEN}✅ Selected: {selected}{Style.RESET_ALL}\n")
                return selected
            else:
                print(f"{Fore.RED}Invalid choice{Style.RESET_ALL}")
                sys.exit(1)
        except (ValueError, KeyboardInterrupt):
            print(f"\n{Fore.RED}Cancelled{Style.RESET_ALL}")
            sys.exit(1)


def detect_chip_type(port):
    """Auto-detect ESP32 chip type (ESP32, C3, S3, C5, or C6)"""
    try:
        import esptool
    except ImportError:
        return None

    esp = None
    try:
        print(f"{Fore.YELLOW}🔍 Detecting chip type...{Style.RESET_ALL}")

        esp = esptool.get_default_connected_device(
            serial_list=[port],
            port=port,
            connect_attempts=3,
            initial_baud=115200
        )

        chip_name = esp.CHIP_NAME

        if 'ESP32-S3' in chip_name:
            print(f"{Fore.GREEN}✅ Detected: ESP32-S3{Style.RESET_ALL}\n")
            return 's3'
        elif 'ESP32-C6' in chip_name:
            print(f"{Fore.GREEN}✅ Detected: ESP32-C6{Style.RESET_ALL}\n")
            return 'c6'
        elif 'ESP32-C5' in chip_name:
            print(f"{Fore.GREEN}✅ Detected: ESP32-C5{Style.RESET_ALL}\n")
            return 'c5'
        elif 'ESP32-C3' in chip_name:
            print(f"{Fore.GREEN}✅ Detected: ESP32-C3{Style.RESET_ALL}\n")
            return 'c3'
        elif chip_name == 'ESP32':
            print(f"{Fore.GREEN}✅ Detected: ESP32{Style.RESET_ALL}\n")
            return 'esp32'
        else:
            print(f"{Fore.YELLOW}⚠️  Unknown chip: {chip_name}{Style.RESET_ALL}\n")
            return None

    except Exception as e:
        print(f"{Fore.YELLOW}⚠️  Could not detect chip type: {e}{Style.RESET_ALL}")
        return None
    finally:
        if esp and hasattr(esp, '_port') and esp._port:
            try:
                esp._port.close()
            except Exception:
                pass
        time.sleep(1)


def prompt_chip_type():
    """Prompt user to manually select chip type"""
    print(f"\n{Fore.CYAN}Please select your ESP32 chip type:{Style.RESET_ALL}")
    print(f"  1. ESP32 (original)")
    print(f"  2. ESP32-C3")
    print(f"  3. ESP32-S3")
    print(f"  4. ESP32-C5")
    print(f"  5. ESP32-C6")
    print()

    try:
        choice = input(f"{Fore.CYAN}Select chip (1-5): {Style.RESET_ALL}")
        mapping = {'1': 'esp32', '2': 'c3', '3': 's3', '4': 'c5', '5': 'c6'}
        chip = mapping.get(choice)
        if chip:
            print(f"{Fore.GREEN}✅ Selected: {chip.upper()}{Style.RESET_ALL}\n")
            return chip
        print(f"{Fore.RED}Invalid choice{Style.RESET_ALL}")
        return None
    except (KeyboardInterrupt, EOFError):
        print(f"\n{Fore.RED}Cancelled{Style.RESET_ALL}")
        return None


def download_firmware(chip: str, firmware_dir: Path) -> Path:
    """Download firmware from GitHub releases if not already cached or hash mismatch"""
    import urllib.request
    import urllib.error
    import hashlib

    chip_suffix_map = {'esp32': '', 'c3': 'C3', 's3': 'S3', 'c5': 'C5', 'c6': 'C6'}
    chip_suffix = chip_suffix_map.get(chip, chip.upper())

    firmware_name = f'{FIRMWARE_NAME_PREFIX}{chip_suffix}.bin' if chip_suffix else 'ESP32_CSI.bin'
    firmware_path = firmware_dir / firmware_name
    expected_hash = FIRMWARE_HASHES.get(firmware_name)

    def calculate_sha256(filepath: Path) -> str:
        sha256 = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()

    if firmware_path.exists():
        if expected_hash:
            current_hash = calculate_sha256(firmware_path)
            if current_hash == expected_hash:
                print(f"{Fore.GREEN}✅ Using cached firmware: {firmware_name} (hash verified){Style.RESET_ALL}")
                return firmware_path
            print(f"{Fore.YELLOW}⚠️  Cached firmware hash mismatch, re-downloading...{Style.RESET_ALL}")
            firmware_path.unlink()
        else:
            print(f"{Fore.GREEN}✅ Using cached firmware: {firmware_name}{Style.RESET_ALL}")
            return firmware_path

    firmware_dir.mkdir(parents=True, exist_ok=True)

    url = f"{FIRMWARE_RELEASE_URL}/{firmware_name}"
    print(f"{Fore.YELLOW}📥 Downloading firmware from GitHub...{Style.RESET_ALL}")
    print(f"{Fore.CYAN}   URL: {url}{Style.RESET_ALL}")

    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            chunk_size = 8192

            with open(firmware_path, 'wb') as f:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size:
                        progress = (downloaded * 100) // total_size
                        print(f"\r{Fore.YELLOW}   Progress: {progress}% ({downloaded // 1024} KB){Style.RESET_ALL}", end='', flush=True)
            print()

        if expected_hash:
            downloaded_hash = calculate_sha256(firmware_path)
            if downloaded_hash != expected_hash:
                print(f"{Fore.RED}❌ Downloaded firmware hash mismatch!{Style.RESET_ALL}")
                firmware_path.unlink()
                sys.exit(1)
            print(f"{Fore.GREEN}✅ Firmware downloaded and verified: {firmware_name}{Style.RESET_ALL}")
        else:
            print(f"{Fore.GREEN}✅ Firmware downloaded: {firmware_name}{Style.RESET_ALL}")

        return firmware_path

    except urllib.error.URLError as e:
        print(f"{Fore.RED}❌ Failed to download firmware: {e}{Style.RESET_ALL}")
        print(f"{Fore.YELLOW}   Check your internet connection or download manually from:{Style.RESET_ALL}")
        print(f"{Fore.CYAN}   https://github.com/francescopace/micropython-esp32-csi/releases{Style.RESET_ALL}")
        sys.exit(1)


def flash_firmware(args):
    """Flash MicroPython firmware to ESP32 using esptool library"""
    try:
        import esptool
    except ImportError:
        print(f"{Fore.RED}❌ esptool not found. Install it with:{Style.RESET_ALL}")
        print("   pip install esptool")
        sys.exit(1)

    port = get_serial_port(args.port)

    chip = args.chip
    if not chip:
        chip = detect_chip_type(port)
        if not chip:
            print(f"\n{Fore.YELLOW}💡 Tip: If the chip is not responding, try:{Style.RESET_ALL}")
            print(f"   1. Hold the BOOT button on your ESP32")
            print(f"   2. Press and release the RESET button (while holding BOOT)")
            print(f"   3. Release the BOOT button")
            print(f"   4. Try flashing again")
            print()
            chip = prompt_chip_type()
            if not chip:
                sys.exit(1)

    script_dir = Path(__file__).parent
    firmware_dir = script_dir / 'firmware'

    if args.firmware:
        firmware_path = Path(args.firmware)
        if not firmware_path.exists():
            print(f"{Fore.RED}❌ Firmware not found: {firmware_path}{Style.RESET_ALL}")
            sys.exit(1)
    else:
        firmware_path = download_firmware(chip, firmware_dir)

    print(f"{Fore.MAGENTA}╔═══════════════════════════════════════════════════════════╗{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}║                 Flashing MicroPython Firmware             ║{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}╚═══════════════════════════════════════════════════════════╝{Style.RESET_ALL}")
    print()
    print(f"{Fore.CYAN}Chip:     {chip.upper()}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Port:     {port}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}Firmware: {firmware_path.name}{Style.RESET_ALL}")
    print()

    chip_name_map = {'esp32': 'esp32', 'c3': 'esp32c3', 's3': 'esp32s3', 'c5': 'esp32c5', 'c6': 'esp32c6'}
    chip_name = chip_name_map.get(chip, 'esp32')

    base_args = ['--chip', chip_name, '--port', port, '--baud', '460800']

    try:
        if args.erase:
            print(f"{Fore.YELLOW}1️⃣  Erasing flash...{Style.RESET_ALL}")
            esptool.main(base_args + ['erase-flash'])
            print(f"{Fore.GREEN}✅ Flash erased{Style.RESET_ALL}\n")
            print(f"{Fore.YELLOW}⏳ Waiting for chip to stabilize...{Style.RESET_ALL}")
            time.sleep(2)

        print(f"{Fore.YELLOW}2️⃣  Flashing firmware...{Style.RESET_ALL}")

        max_retries = 3
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    print(f"{Fore.YELLOW}🔄 Retry attempt {attempt + 1}/{max_retries}...{Style.RESET_ALL}")
                    time.sleep(2)

                flash_offset_map = {'esp32': '0x1000', 'c3': '0x0', 's3': '0x0', 'c5': '0x2000', 'c6': '0x0'}
                flash_offset = flash_offset_map.get(chip, '0x0')

                flash_args = base_args + [
                    '--before', 'default-reset',
                    '--after', 'hard-reset',
                    'write-flash',
                    '--flash-mode', 'dio',
                    '--flash-freq', '40m',
                    '--flash-size', 'detect',
                    flash_offset,
                    str(firmware_path)
                ]

                esptool.main(flash_args)

                print()
                print(f"{Fore.GREEN}✅ Firmware flashed successfully!{Style.RESET_ALL}")
                print()
                print(f"{Fore.CYAN}Next steps:{Style.RESET_ALL}")
                print(f"  1. cp src/config_local.py.example src/config_local.py")
                print(f"  2. Edit src/config_local.py with your credentials")
                print(f"  3. {Fore.GREEN}./setup.py deploy{Style.RESET_ALL}")
                print(f"  4. {Fore.GREEN}./setup.py run{Style.RESET_ALL}")
                print()
                return

            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"{Fore.YELLOW}⚠️  Attempt {attempt + 1} failed: {e}{Style.RESET_ALL}")
                    continue
                raise

    except Exception as e:
        print(f"\n{Fore.RED}❌ Error flashing firmware: {e}{Style.RESET_ALL}")
        print(f"\n{Fore.YELLOW}Troubleshooting tips:{Style.RESET_ALL}")
        print(f"  1. Try holding the BOOT button while connecting")
        print(f"  2. Use a different USB cable (data cable, not charge-only)")
        print(f"  3. Try a different USB port (preferably USB 2.0)")
        print(f"  4. Ensure no other programs are using the serial port")
        print(f"  5. Try with --erase flag: {Fore.GREEN}./setup.py flash --erase{Style.RESET_ALL}")
        print()
        sys.exit(1)


def deploy_code(args):
    """Deploy Python code to MicroPython device using mpremote"""
    try:
        subprocess.run(['mpremote', '--version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print(f"{Fore.RED}❌ mpremote not found. Install it with:{Style.RESET_ALL}")
        print("   pip install mpremote")
        sys.exit(1)

    port = get_serial_port(args.port)

    if not Path('src/config_local.py').exists():
        print(f"{Fore.RED}❌ src/config_local.py not found!{Style.RESET_ALL}")
        print(f"\n{Fore.YELLOW}Create it from the template:{Style.RESET_ALL}")
        print(f"  cp src/config_local.py.example src/config_local.py")
        print(f"  # Then edit src/config_local.py with your credentials")
        print()
        sys.exit(1)

    print(f"{Fore.MAGENTA}╔═══════════════════════════════════════════════════════════╗{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}║                  Deploying Code to Device                 ║{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}╚═══════════════════════════════════════════════════════════╝{Style.RESET_ALL}")
    print()
    print(f"{Fore.CYAN}Port: {port}{Style.RESET_ALL}")
    print()

    try:
        health = subprocess.run(
            ['mpremote', 'connect', port, 'exec', 'print("MP_OK")'],
            capture_output=True, text=True
        )
        if health.returncode != 0 or 'MP_OK' not in (health.stdout or ''):
            print(f"{Fore.RED}❌ Device is not running a valid MicroPython firmware{Style.RESET_ALL}")
            print(f"{Fore.YELLOW}   Serial output suggests boot failure (e.g. invalid header).{Style.RESET_ALL}")
            print(f"\n{Fore.CYAN}Recommended fix:{Style.RESET_ALL}")
            print(f"  {Fore.GREEN}./setup.py flash --erase{Style.RESET_ALL}")
            print(f"  {Fore.GREEN}./setup.py deploy{Style.RESET_ALL}")
            print()
            sys.exit(1)

        print(f"{Fore.YELLOW}📁 Creating directories...{Style.RESET_ALL}")
        subprocess.run(['mpremote', 'connect', port, 'mkdir', ':src'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)

        print(f"{Fore.YELLOW}📤 Uploading files...{Style.RESET_ALL}")

        files_to_upload: List[Tuple[str, str]] = [
            ('src/__init__.py', ':src/'),
            ('src/config.py', ':src/'),
            ('src/config_local.py', ':src/'),
            ('src/utils.py', ':src/'),
            ('src/traffic_generator.py', ':src/'),
            ('src/main.py', ':src/'),
            ('main.py', ':/'),
        ]

        for src, dst in files_to_upload:
            if not Path(src).exists():
                print(f"{Fore.RED}  ❌ File not found: {src}{Style.RESET_ALL}")
                continue
            print(f"  {src} → {dst}")
            subprocess.run(['mpremote', 'connect', port, 'cp', src, dst],
                          check=True, capture_output=True)

        print()
        print(f"{Fore.GREEN}✅ Deployment complete!{Style.RESET_ALL}")
        print()
        print(f"{Fore.CYAN}To run the application:{Style.RESET_ALL}")
        print(f"  ./setup.py run")
        print()

    except subprocess.CalledProcessError as e:
        print(f"\n{Fore.RED}❌ Error during deployment: {e}{Style.RESET_ALL}")
        sys.exit(1)
    except Exception as e:
        print(f"\n{Fore.RED}❌ Unexpected error: {e}{Style.RESET_ALL}")
        sys.exit(1)

def run_application(args):
    """Run application on ESP32"""
    try:
        subprocess.run(['mpremote', '--version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print(f"{Fore.RED}❌ mpremote not found. Install it with:{Style.RESET_ALL}")
        print("   pip install mpremote")
        sys.exit(1)

    port = get_serial_port(args.port)

    print(f"{Fore.MAGENTA}╔═══════════════════════════════════════════════════════════╗{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}║                  Running Application                      ║{Style.RESET_ALL}")
    print(f"{Fore.MAGENTA}╚═══════════════════════════════════════════════════════════╝{Style.RESET_ALL}")
    print()
    print(f"{Fore.YELLOW}🚀 Starting application...{Style.RESET_ALL}")
    print()

    process = None
    try:
        process = subprocess.Popen(['mpremote', 'connect', port, 'run', 'src/main.py'])
        process.wait()

    except subprocess.CalledProcessError as e:
        print(f"\n{Fore.RED}❌ Error: {e}{Style.RESET_ALL}")
        sys.exit(1)
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Application stopped - cleaning up ESP32...{Style.RESET_ALL}")
        if process:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
        # Hard reset to fully clear WiFi/CSI/PHY state (soft_reset isn't enough)
        time.sleep(0.5)
        try:
            subprocess.run(
                ['mpremote', 'connect', port, 'exec', 'import machine; machine.reset()'],
                timeout=5, capture_output=True
            )
        except Exception:
            pass  # machine.reset() causes immediate reboot; timeout/error is expected
        print(f"{Fore.GREEN}ESP32 reset completed{Style.RESET_ALL}")
    except Exception as e:
        print(f"\n{Fore.RED}❌ Unexpected error: {e}{Style.RESET_ALL}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="ESPectre CLI - Device Flash / Deploy / Run",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ./setup.py flash --erase
  ./setup.py deploy
  ./setup.py run
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    flash_parser = subparsers.add_parser('flash', help='Flash MicroPython firmware to ESP32')
    flash_parser.add_argument('--chip', choices=['esp32', 'c3', 's3', 'c5', 'c6'],
                             help='ESP32 chip type (auto-detected if not specified)')
    flash_parser.add_argument('--port', help='Serial port (auto-detected if not specified)')
    flash_parser.add_argument('--erase', action='store_true',
                             help='Erase flash before flashing (recommended)')
    flash_parser.add_argument('--firmware', help='Custom firmware path (optional)')

    deploy_parser = subparsers.add_parser('deploy', help='Deploy code to MicroPython device')
    deploy_parser.add_argument('--port', help='Serial port (auto-detected if not specified)')

    run_parser = subparsers.add_parser('run', help='Run application on ESP32')
    run_parser.add_argument('--port', help='Serial port (auto-detected if not specified)')

    args = parser.parse_args()

    import src.config_local as s
    if (s.WIFI_SSID == None or s.WIFI_PASSWORD == None or s.LOCAL_IP == None):
        print("Config file not written, Auto-Detecting Wi-Fi information...")
        print()
        try:
            info = get_wifi_info()
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)
        if not info:
            print("No active Wi-Fi connection found.")
            sys.exit(1)
        conf = f'''# WiFi Configuration
WIFI_SSID = "{info['ssid']}"
WIFI_PASSWORD = "{info['password']}"
LOCAL_IP = "{info['local_ip']}"
'''

        with open("./src/config_local.py", "w") as a:
            a.write(conf)
    del s

    if args.command == 'flash':
        flash_firmware(args)
    elif args.command == 'deploy':
        deploy_code(args)
    elif args.command == 'run':
        run_application(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
