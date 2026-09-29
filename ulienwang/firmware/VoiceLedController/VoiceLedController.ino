// AMB82-MINI voice LED controller
// Serial protocol: one ASCII command per line at 115200 bps.

const unsigned long SERIAL_BAUD = 115200;
const size_t MAX_COMMAND_LENGTH = 32;

char commandBuffer[MAX_COMMAND_LENGTH + 1];
size_t commandLength = 0;
bool commandOverflow = false;

void reportState()
{
    Serial.print("STATE blue=");
    Serial.print(digitalRead(LED_B) == HIGH ? 1 : 0);
    Serial.print(" green=");
    Serial.println(digitalRead(LED_G) == HIGH ? 1 : 0);
}

void acknowledge(const char *command)
{
    Serial.print("ACK ");
    Serial.println(command);
}

void blinkThreeTimes()
{
    const int blueBefore = digitalRead(LED_B);
    const int greenBefore = digitalRead(LED_G);

    for (int count = 0; count < 3; count++) {
        digitalWrite(LED_B, HIGH);
        digitalWrite(LED_G, HIGH);
        delay(250);
        digitalWrite(LED_B, LOW);
        digitalWrite(LED_G, LOW);
        delay(250);
    }

    digitalWrite(LED_B, blueBefore);
    digitalWrite(LED_G, greenBefore);
}

void processCommand(const char *command)
{
    if (strcmp(command, "LEFT_ON") == 0) {
        digitalWrite(LED_B, HIGH);
    } else if (strcmp(command, "LEFT_OFF") == 0) {
        digitalWrite(LED_B, LOW);
    } else if (strcmp(command, "RIGHT_ON") == 0) {
        digitalWrite(LED_G, HIGH);
    } else if (strcmp(command, "RIGHT_OFF") == 0) {
        digitalWrite(LED_G, LOW);
    } else if (strcmp(command, "ALL_ON") == 0) {
        digitalWrite(LED_B, HIGH);
        digitalWrite(LED_G, HIGH);
    } else if (strcmp(command, "ALL_OFF") == 0) {
        digitalWrite(LED_B, LOW);
        digitalWrite(LED_G, LOW);
    } else if (strcmp(command, "BLINK_3") == 0) {
        acknowledge(command);
        blinkThreeTimes();
        reportState();
        return;
    } else if (strcmp(command, "STATUS") == 0) {
        acknowledge(command);
        reportState();
        return;
    } else {
        Serial.println("ERR UNKNOWN_COMMAND");
        reportState();
        return;
    }

    acknowledge(command);
    reportState();
}

void setup()
{
    pinMode(LED_B, OUTPUT);
    pinMode(LED_G, OUTPUT);
    digitalWrite(LED_B, LOW);
    digitalWrite(LED_G, LOW);

    Serial.begin(SERIAL_BAUD);
    delay(300);
    Serial.println("READY AMB82-MINI");
    reportState();
}

void loop()
{
    while (Serial.available() > 0) {
        const char incoming = static_cast<char>(Serial.read());

        if (incoming == '\r') {
            continue;
        }

        if (incoming == '\n') {
            if (commandOverflow) {
                Serial.println("ERR COMMAND_TOO_LONG");
                reportState();
            } else if (commandLength > 0) {
                commandBuffer[commandLength] = '\0';
                processCommand(commandBuffer);
            }

            commandLength = 0;
            commandOverflow = false;
            continue;
        }

        if (commandOverflow) {
            continue;
        }

        if (commandLength < MAX_COMMAND_LENGTH) {
            commandBuffer[commandLength++] = incoming;
        } else {
            commandOverflow = true;
        }
    }
}

